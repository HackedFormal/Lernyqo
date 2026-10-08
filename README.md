# Lernyqo — One upload. Complete revision.

Lernyqo is a first-year hackathon MVP built around one simple learning loop:

**Upload → Understand → Practice → Identify mistakes → Revise → Test**

The product is intentionally simple enough for a first-year student to explain, while still demonstrating a real full-stack workflow.

## What changed in this version

- Study Lab is now a **selected-material workspace**, not a wall of buttons.
- Summary, concepts, flashcards, quiz and practice test live inside that workspace.
- Quiz settings: 5/10/15/20 questions + Easy/Medium/Hard/Mixed.
- Quiz results show the actual question, explanation and weak topics.
- Wrong quiz answers can become real Mistake Notebook entries.
- Mistake Notebook supports search, Open/Fixed filters, edit, delete and mark-fixed.
- Dashboard now shows a **Next Best Action** instead of only statistics.
- Exam Planner creates a simple timeline based on days remaining.
- Practice Test supports MCQ and short-answer questions. MCQs are auto-scored; short answers are self-check.
- Generated content is cached where sensible to reduce repeated AI calls.
- Live AI uses the **Gemini API** from the backend; Demo Mode remains available without an API key.
- The API key is never placed in frontend JavaScript.
- UI uses a restrained navy/teal/mint visual system with Manrope + DM Sans typography.

## The AI setup

Lernyqo has two modes:

### 1. Demo Mode — default

No API key is required.

It is clearly labelled `DEMO MODE`. It exists so the hackathon demonstration still works if you do not have an API key or the network is unreliable.

### 2. Gemini Live AI — optional

The backend can use Gemini to transform the **uploaded material itself** into:

- revision summaries
- key concepts
- flashcards
- quizzes
- practice tests

The source material is explicitly provided as the primary factual source, and structured JSON is validated before Lernyqo stores it.

Google's Gemini API currently offers a free tier for eligible models, and Google's Python SDK supports structured JSON output with schemas. Check the current limits in Google AI Studio before a large demo. urlGemini API pricinghttps://ai.google.dev/gemini-api/docs/pricing

## Windows setup — LEGO-simple version

1. Install Python 3.11 or newer.
2. Extract the Lernyqo ZIP.
3. Open the extracted folder.
4. Double-click `START.bat`.
5. Wait for the first-time setup.
6. Your browser opens `http://127.0.0.1:8000`.
7. Keep the black terminal window open.

The app works immediately in Demo Mode.

## Turning on free Gemini AI

1. Open Google AI Studio's API-key page.
2. Create/copy a Gemini API key.
3. Open the `.env` file inside Lernyqo.
4. Change:

```text
DEMO_MODE=true
```

to:

```text
DEMO_MODE=false
```

5. Add:

```text
GEMINI_API_KEY=your_key_here
```

6. Save the file.
7. Start Lernyqo again with `START.bat`.

Do **not** put the key into `frontend/app.js` or `frontend/index.html`.

Google's current Python SDK uses `google-genai`, and its structured-output support can constrain model responses to a schema before the application validates the result. urlGemini structured outputs documentationhttps://ai.google.dev/gemini-api/docs/structured-output

## Folder structure

```text
lernyqo/
├── START.bat
├── README.md
├── README_FIRST.txt
├── requirements.txt
├── .env.example
├── .gitignore
├── lernyqo.db
├── backend/
│   ├── main.py
│   ├── database.py
│   ├── models.py
│   ├── schemas.py
│   ├── services/
│   │   ├── ai_service.py
│   │   └── file_service.py
│   └── uploads/
└── frontend/
    ├── index.html
    ├── app.js
    └── styles.css
```

## Hackathon demo — 3 to 5 minutes

1. Open Dashboard.
2. Click **Try demo material**.
3. Open the material workspace.
4. Show the Summary.
5. Show Key Concepts.
6. Flip through Flashcards.
7. Start a 5-question Quiz.
8. Deliberately answer one question incorrectly.
9. Add it to Mistake Notebook.
10. Open the notebook and show the saved mistake.
11. Build a Practice Test.
12. Return to Dashboard and show the real activity numbers.
13. Add an upcoming exam and show the preparation timeline.

If Live AI is configured, repeat the flow with a real study PDF so the judge can see the content change according to the uploaded source.

## What is real and what is demo

### Real

- FastAPI backend
- SQLite persistence
- PDF/TXT/MD upload and text extraction
- Image OCR when local Tesseract is available
- Generated-content storage
- Quiz generation and scoring
- Weak-topic detection
- Mistake Notebook persistence
- Exam persistence and countdown
- Practice-test submission
- Dashboard calculations
- Optional Gemini API integration

### Demo fallback

When Demo Mode is active, educational generation is deterministic sample content designed to demonstrate the workflow. It is explicitly labelled as Demo Mode and is not represented as live AI.

## Genuine limitations

- This is a local single-student hackathon MVP; authentication and multi-user accounts are intentionally out of scope.
- Short-answer practice-test questions are self-check rather than automatically graded.
- Image OCR depends on a working local Tesseract installation.
- Gemini free-tier limits can change, so a hackathon demo should keep Demo Mode available as a backup.
- The supplied original backend/frontend source files were not included in the upload package, so this version is a compatible reconstruction around the supplied database and project specification rather than a line-by-line edit of missing source files.

## Stopping Lernyqo

Close the black terminal window, or press `Ctrl+C` inside it.

If something breaks, **do not delete random files**. Take a screenshot of the black terminal window and send it to ChatGPT.
