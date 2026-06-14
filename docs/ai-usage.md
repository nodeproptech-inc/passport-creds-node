# AI Usage — PassportCreds by Node

## AI in the Product

PassportCreds uses the **Chainlink Confidential AI Attester** as the compliance evaluation engine. When a user uploads a compliance document (KYC/AML or Accredited Investor evidence), the document is sent to a Trusted Execution Environment (TEE) where Gemma4 evaluates it and returns a structured JSON verdict — `approved`, `confidence`, `reasonCode`, `summary`. The document never leaves the enclave. The verdict never touches a smart contract. Only a `keccak256` attestation hash is written onchain as a fingerprint of the evaluation.

This primitive fit our use case almost by accident. We were looking for a way to evaluate sensitive compliance documents without storing or exposing PII anywhere in the pipeline. The Confidential AI Attester is exactly that.

## AI in Development

Claude Code (Claude Sonnet) and ChatGPT were used as coding assistants throughout the build — architecture scaffolding, boilerplate, debugging, and contract design iteration. All product decisions, protocol architecture, and system design are human-authored.

## Origin of the Idea

This project was not AI-generated. The concept came from a real internal problem at **Node PropTech**: how do you verify that investors accessing a regulated deal room are KYC-cleared and accredited — without storing sensitive documents, without a fragile manual process, and without building a different integration for every compliance provider?

We realised this problem is not unique to us. Any regulated platform dealing with tokenised assets, private equity, or real estate faces the same friction. PassportCreds is our answer: a white-label, protocol-agnostic Compliance Passport that any platform can embed.
