import { useState } from "react";
import {
  IDKitRequestWidget,
  identityCheck,
  type RpContext,
} from "@worldcoin/idkit";

type RpSignatureResponse = {
  app_id: `app_${string}`;
  rp_context: RpContext;
};

type VerificationStatus = "idle" | "verifying" | "verified" | "error";

function App() {
  const [open, setOpen] = useState(false);
  const [appId, setAppId] = useState<`app_${string}` | null>(null);
  const [rpContext, setRpContext] = useState<RpContext | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [verificationStatus, setVerificationStatus] =
    useState<VerificationStatus>("idle");

  const preset = identityCheck({
    attributes: [
      { type: "document_type", value: "passport" },
      { type: "minimum_age", value: 18 },
    ],
  });

  const requestIdentityCheck = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    setVerificationStatus("idle");

    try {
      const response = await fetch("/api/rp-signature", { method: "POST" });

      if (!response.ok) {
        throw new Error("The backend could not create a verification request.");
      }

      const data = (await response.json()) as RpSignatureResponse;

      if (!data.app_id || !data.rp_context) {
        throw new Error("The backend returned an invalid verification request.");
      }

      setAppId(data.app_id);
      setRpContext(data.rp_context);
      setOpen(true);
    } catch (error) {
      console.error("Unable to start identity check:", error);
      setErrorMessage("Unable to start the identity check. Please try again.");
      setVerificationStatus("error");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main>
      <h1>Identity Check Test</h1>

      <button onClick={requestIdentityCheck} disabled={isLoading}>
        {isLoading ? "Preparing verification…" : "Verify identity"}
      </button>

      {errorMessage && <p role="alert">{errorMessage}</p>}
      {verificationStatus === "verifying" && (
        <p role="status">Verifying identity…</p>
      )}
      {verificationStatus === "verified" && (
        <p role="status">Identity verified</p>
      )}

      {appId && rpContext && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={setOpen}
          app_id={appId}
          action="identity-check"
          rp_context={rpContext}
          allow_legacy_proofs={false}
          environment="staging"
          preset={preset}
          handleVerify={async (result) => {
            setVerificationStatus("verifying");
            setErrorMessage(null);

            const response = await fetch("/api/verify-proof", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ idkitResponse: result }),
            });

            if (!response.ok) {
              const errorPayload = (await response.json().catch(() => null)) as {
                error?: unknown;
              } | null;
              const message =
                typeof errorPayload?.error === "string"
                  ? errorPayload.error
                  : "Identity verification failed. Please try again.";

              setVerificationStatus("error");
              setErrorMessage(message);
              throw new Error(message);
            }
          }}
          onSuccess={() => {
            setVerificationStatus("verified");
            setErrorMessage(null);
          }}
          onError={(errorCode, debugReport) => {
            console.error("IDKit error:", errorCode);
            console.error("Debug report:", debugReport);
            setVerificationStatus("error");
            setErrorMessage((currentMessage) => {
              if (currentMessage) {
                return currentMessage;
              }

              return errorCode === "user_rejected"
                ? "Identity check was cancelled."
                : "Identity check could not be completed.";
            });
          }}
        />
      )}
    </main>
  );
}

export default App;
