"use client";

import { useEffect, useRef } from "react";

import type { AppView } from "@/components/app-shell/side-nav";

type WorkspaceTelemetryProps = {
  activeView: AppView;
};

export function WorkspaceTelemetry({ activeView }: WorkspaceTelemetryProps) {
  const activeViewRef = useRef(activeView);
  const enteredAtRef = useRef<number | null>(null);

  useEffect(() => {
    activeViewRef.current = activeView;
    enteredAtRef.current = Date.now();

    recordTelemetry({
      eventType: "page_view",
      page: activeView,
      path: window.location.pathname,
    });

    return () => {
      if (enteredAtRef.current !== null) {
        recordPageTime(activeViewRef.current, enteredAtRef.current);
      }
    };
  }, [activeView]);

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        if (enteredAtRef.current !== null) {
          recordPageTime(activeViewRef.current, enteredAtRef.current);
        }

        enteredAtRef.current = Date.now();
      }
    }

    function handleError(event: ErrorEvent) {
      recordTelemetry({
        area: "client_runtime",
        errorCode: event.error?.name ?? "CLIENT_RUNTIME_ERROR",
        eventType: "client_error",
        message: event.message,
        path: window.location.pathname,
        severity: "high",
      });
    }

    function handleUnhandledRejection(event: PromiseRejectionEvent) {
      const reason = event.reason instanceof Error ? event.reason.message : String(event.reason ?? "");

      recordTelemetry({
        area: "client_runtime",
        errorCode: "UNHANDLED_PROMISE_REJECTION",
        eventType: "client_error",
        message: reason.slice(0, 500) || "Unhandled promise rejection",
        path: window.location.pathname,
        severity: "high",
      });
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
    };
  }, []);

  return null;
}

function recordPageTime(page: AppView, enteredAt: number) {
  const durationSeconds = Math.max(0, (Date.now() - enteredAt) / 1000);

  if (durationSeconds < 1) {
    return;
  }

  recordTelemetry({
    durationSeconds,
    eventType: "page_time",
    page,
    path: window.location.pathname,
  });
}

function recordTelemetry(payload: Record<string, unknown>) {
  const body = JSON.stringify(payload);

  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: "application/json" });
    const queued = navigator.sendBeacon("/api/telemetry/events", blob);

    if (queued) {
      return;
    }
  }

  void fetch("/api/telemetry/events", {
    body,
    headers: {
      "content-type": "application/json",
    },
    keepalive: true,
    method: "POST",
  }).catch(() => {
    // Telemetry should never interrupt the user journey.
  });
}
