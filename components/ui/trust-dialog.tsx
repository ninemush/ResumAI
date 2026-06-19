"use client";

import { AlertTriangle, Loader2, ShieldCheck, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function useTrustDialog() {
  const [request, setRequest] = useState<DialogRequest | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const dialogRef = useRef<HTMLFormElement | null>(null);
  const isWorkingRef = useRef(false);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    isWorkingRef.current = isWorking;
  }, [isWorking]);

  const restoreFocus = useCallback(() => {
    const target = restoreFocusRef.current;
    restoreFocusRef.current = null;

    if (!target?.isConnected) {
      return;
    }

    window.setTimeout(() => target.focus(), 0);
  }, []);

  const openDialog = useCallback((nextRequest: DialogRequest) => {
    if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
      restoreFocusRef.current = document.activeElement;
    }

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

  const settleDialog = useCallback(
    (dialogRequest: DialogRequest, value: string | boolean | null) => {
      dialogRequest.resolve(value);
      setRequest(null);
      setFailure(null);
      restoreFocus();
    },
    [restoreFocus],
  );

  const closeDialog = useCallback(
    (value: string | boolean | null) => {
      if (isWorkingRef.current || !request) {
        return;
      }

      settleDialog(request, value);
    },
    [request, settleDialog],
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

        settleDialog(request, trimmed);
        return;
      }

      if (!request.action) {
        settleDialog(request, true);
        return;
      }

      setIsWorking(true);
      setFailure(null);

      try {
        await request.action();
        settleDialog(request, true);
      } catch (error) {
        setFailure(error instanceof Error ? error.message : "This action could not be completed.");
      } finally {
        setIsWorking(false);
      }
    },
    [inputValue, request, settleDialog],
  );

  useEffect(() => {
    if (!request) {
      return;
    }

    const dialog = dialogRef.current;

    if (!dialog) {
      return;
    }

    const focusInitialElement = () => {
      const textarea = dialog.querySelector<HTMLTextAreaElement>("textarea:not([disabled])");
      const firstFocusable = getFocusableElements(dialog)[0];

      (textarea ?? firstFocusable ?? dialog).focus();
    };

    const animationFrame = window.requestAnimationFrame(focusInitialElement);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDialog(null);
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = getFocusableElements(dialog);

      if (focusableElements.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement;

      if (event.shiftKey && (!activeElement || activeElement === firstElement || !dialog.contains(activeElement))) {
        event.preventDefault();
        lastElement.focus();
        return;
      }

      if (!event.shiftKey && activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeDialog, request]);

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
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          tabIndex={-1}
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

function getFocusableElements(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => {
    if (element.getAttribute("aria-hidden") === "true") {
      return false;
    }

    const styles = window.getComputedStyle(element);

    return styles.display !== "none" && styles.visibility !== "hidden";
  });
}
