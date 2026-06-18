"use client";

import { AlertTriangle, Loader2, ShieldCheck, X } from "lucide-react";
import { useCallback, useState } from "react";
import type { FormEvent, ReactNode } from "react";

type TrustDialogIntent = "default" | "admin" | "danger" | "paid";

export type TrustDialogOptions = {
  cancelLabel?: string;
  confirmLabel?: string;
  consequence?: string;
  description: ReactNode;
  impact?: string;
  input?: {
    initialValue?: string;
    label: string;
    placeholder?: string;
    required?: boolean;
  };
  intent?: TrustDialogIntent;
  title: string;
};

type DialogRequest =
  | {
      action?: undefined;
      options: TrustDialogOptions;
      resolve: (value: string | boolean | null) => void;
    }
  | {
      action: () => Promise<unknown>;
      options: TrustDialogOptions;
      resolve: (value: string | boolean | null) => void;
    };

export type TrustDialogConfirm = (options: TrustDialogOptions) => Promise<boolean>;
export type TrustDialogPrompt = (options: TrustDialogOptions) => Promise<string | null>;

export function useTrustDialog() {
  const [request, setRequest] = useState<DialogRequest | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const openDialog = useCallback((nextRequest: DialogRequest) => {
    setFailure(null);
    setIsWorking(false);
    setInputValue(nextRequest.options.input?.initialValue ?? "");
    setRequest(nextRequest);
  }, []);

  const confirm = useCallback<TrustDialogConfirm>(
    (options) =>
      new Promise<boolean>((resolve) => {
        openDialog({
          options,
          resolve: (value) => resolve(value === true),
        });
      }),
    [openDialog],
  );

  const prompt = useCallback<TrustDialogPrompt>(
    (options) =>
      new Promise<string | null>((resolve) => {
        openDialog({
          options,
          resolve: (value) => resolve(typeof value === "string" ? value : null),
        });
      }),
    [openDialog],
  );

  const runWithConfirmation = useCallback(
    <T,>(options: TrustDialogOptions, action: () => Promise<T>) =>
      new Promise<boolean>((resolve) => {
        openDialog({
          action,
          options,
          resolve: (value) => resolve(value === true),
        });
      }),
    [openDialog],
  );

  const closeDialog = useCallback(
    (value: string | boolean | null) => {
      if (isWorking) {
        return;
      }

      request?.resolve(value);
      setRequest(null);
      setFailure(null);
    },
    [isWorking, request],
  );

  const submitDialog = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();

      if (!request) {
        return;
      }

      if (request.options.input) {
        const trimmed = inputValue.trim();

        if (request.options.input.required && !trimmed) {
          setFailure("Add the requested detail before continuing.");
          return;
        }

        request.resolve(trimmed);
        setRequest(null);
        setFailure(null);
        return;
      }

      if (!request.action) {
        request.resolve(true);
        setRequest(null);
        setFailure(null);
        return;
      }

      setIsWorking(true);
      setFailure(null);

      try {
        await request.action();
        request.resolve(true);
        setRequest(null);
      } catch (error) {
        setFailure(error instanceof Error ? error.message : "This action could not be completed.");
      } finally {
        setIsWorking(false);
      }
    },
    [inputValue, request],
  );

  const TrustDialog = useCallback(() => {
    if (!request) {
      return null;
    }

    const { options } = request;
    const intent = options.intent ?? "default";
    const confirmLabel =
      options.confirmLabel ?? (options.input ? "Save" : intent === "danger" ? "Confirm" : "Continue");
    const cancelLabel = options.cancelLabel ?? "Cancel";

    return (
      <div className="trust-dialog-backdrop" role="presentation">
        <form
          aria-describedby="trust-dialog-description"
          aria-labelledby="trust-dialog-title"
          className={`trust-dialog trust-dialog-${intent}`}
          onSubmit={submitDialog}
          role="dialog"
          aria-modal="true"
        >
          <button
            aria-label="Close dialog"
            className="icon-button trust-dialog-close"
            disabled={isWorking}
            onClick={() => closeDialog(null)}
            type="button"
          >
            <X size={16} aria-hidden="true" />
          </button>
          <div className="trust-dialog-icon" aria-hidden="true">
            {intent === "danger" ? <AlertTriangle size={22} /> : <ShieldCheck size={22} />}
          </div>
          <div className="trust-dialog-copy">
            <h2 id="trust-dialog-title">{options.title}</h2>
            <div id="trust-dialog-description" className="trust-dialog-description">
              {typeof options.description === "string" ? <p>{options.description}</p> : options.description}
            </div>
            {options.impact ? <p className="trust-dialog-impact">{options.impact}</p> : null}
            {options.consequence ? <p className="trust-dialog-consequence">{options.consequence}</p> : null}
            {options.input ? (
              <label className="trust-dialog-input">
                {options.input.label}
                <textarea
                  autoFocus
                  disabled={isWorking}
                  onChange={(event) => setInputValue(event.target.value)}
                  placeholder={options.input.placeholder}
                  rows={3}
                  value={inputValue}
                />
              </label>
            ) : null}
            {failure ? (
              <p className="trust-dialog-failure" role="alert">
                {failure} You can adjust the details and try again.
              </p>
            ) : null}
          </div>
          <div className="trust-dialog-actions">
            <button
              className="secondary-action"
              disabled={isWorking}
              onClick={() => closeDialog(null)}
              type="button"
            >
              {cancelLabel}
            </button>
            <button className="primary-action" disabled={isWorking} type="submit">
              {isWorking ? <Loader2 className="spin" size={16} aria-hidden="true" /> : null}
              {failure && request.action ? "Try again" : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    );
  }, [closeDialog, failure, inputValue, isWorking, request, submitDialog]);

  return { confirm, prompt, runWithConfirmation, TrustDialog };
}
