---
name: source-docs-intake
description: "Collect, or interview and draft, the squad's source documents (PRD, Tech Spec, Design, Environments, or the Blueprint's own documents) and get the owner's approval before work starts. Use as the lead before the first sprint or campaign, or when a source document is missing or still DRAFT."
---
# Source document intake

The squad works only from approved source documents. The Blueprint section in `AISQUAD.md` lists them (path, purpose, owner).

## Steps
1. List the source documents and their status: the first lines of each file hold `STATUS: DRAFT` or `STATUS: APPROVED`; a missing file counts as missing.
2. Ask the owner for every document that is missing or DRAFT: "Do you already have a PRD / tech spec / design (files, links, mockups)?" Offer to draft the ones they do not have. Use AskUserQuestion (one question per document, options such as "I will send it" / "Draft it with me"), so the question reaches the owner's Attention list.
3. When the owner provides material, store it in the documented path (mockups under `docs/design/`), never in chat only.
4. **Premise check** before drafting a PRD: ask the owner these forcing questions (AskUserQuestion with options where you can propose answers, a short plain question otherwise), and write the answers in a `## Premise` section at the top of the PRD:
   - Who exactly is the user (one concrete person or role, not "everyone")?
   - What painful problem do they have today, and how do they solve it now?
   - What happens if we build nothing?
   - What is the smallest version that proves the value?
   - How will we know it worked (a number or an observable change)?
   - What will we not build (now)?
   If an answer is vague, ask once more with a concrete proposal; then record it as `ASSUMPTION:`.
5. When something is missing, interview the owner with short, concrete questions, a few at a time:
   - PRD: users, problems, must-have features, acceptance criteria per feature, what is out of scope, priorities.
   - Tech Spec: stack constraints, hosting, data that must be kept, integrations, who maintains it later.
   - Design: existing brand, screens they imagine, devices, which parts are fixed and which may be improved.
   - Environments: where it runs, domains, which services exist (names only, never secrets).
6. Draft the document from the answers with the skeleton already in the repo. Mark assumptions with `ASSUMPTION:` so the owner sees them.
7. Show the owner a short summary (a few lines; the document holds the details) and ask for approval with AskUserQuestion, one question per document ("Approve" / "Needs changes"), and one per `ASSUMPTION:` that needs a decision. Only after a clear yes, set `STATUS: APPROVED` and the approval date.
8. Record open questions in the questions file and keep the work blocked until every required document is approved.

## Never
- Start a sprint, campaign or prospecting batch while a required document is not approved.
- Write secrets or personal data into a source document.
