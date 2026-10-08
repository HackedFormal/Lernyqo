import mimetypes
import os
from datetime import date
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import desc, func
from sqlalchemy.orm import Session

from .database import Base, engine, get_db, run_compat_migrations
from .models import (
    Exam, GeneratedContent, Mistake, Quiz, QuizAttempt, QuizQuestion,
    StudyMaterial, Test, TestAttempt, User,
)
from .schemas import (
    ExamIn, FlashcardGenerateIn, MistakeIn, MistakeUpdate, QuizGenerateIn,
    QuizSubmitIn, TestGenerateIn, TestSubmitIn,
)
from .services.ai_service import AIService
from .services.file_service import ALLOWED, extract_text, safe_name

load_dotenv()
ROOT = Path(__file__).resolve().parent.parent
UPLOADS = ROOT / "backend" / "uploads"
UPLOADS.mkdir(parents=True, exist_ok=True)
Base.metadata.create_all(bind=engine)
run_compat_migrations()

app = FastAPI(title="Lernyqo API", version="2.0.0")
origins = [x.strip() for x in os.getenv("CORS_ORIGINS", "http://127.0.0.1:8000,http://localhost:8000").split(",") if x.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"], allow_headers=["*"])


def current_user(db: Session):
    user = db.query(User).order_by(User.id).first()
    if not user:
        user = User(name="Lernyqo Student")
        db.add(user)
        db.commit()
        db.refresh(user)
    return user


def material_out(m):
    return {
        "id": m.id,
        "filename": m.filename,
        "content_type": m.content_type,
        "size_bytes": m.size_bytes,
        "created_at": m.created_at,
        "extracted_text_available": bool(m.extracted_text.strip()),
    }


def material_or_404(db, material_id):
    m = db.get(StudyMaterial, material_id)
    if not m:
        raise HTTPException(404, "Material not found.")
    return m


@app.get("/api/health")
def health():
    ai = AIService()
    return {"status": "ok", "ai_mode": ai.mode, "ai_provider": "gemini" if ai.mode == "live" else "demo"}


@app.get("/api/materials")
def materials(db: Session = Depends(get_db)):
    return [material_out(x) for x in db.query(StudyMaterial).order_by(desc(StudyMaterial.created_at)).all()]


@app.get("/api/materials/{material_id}")
def material(material_id: int, db: Session = Depends(get_db)):
    m = material_or_404(db, material_id)
    return {**material_out(m), "extracted_text": m.extracted_text}


@app.post("/api/materials/upload")
async def upload_material(file: UploadFile = File(...), db: Session = Depends(get_db)):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED:
        raise HTTPException(400, "Unsupported file type. Use PDF, TXT, MD, JPG, JPEG or PNG.")
    max_bytes = int(os.getenv("MAX_UPLOAD_MB", "15")) * 1024 * 1024
    data = await file.read()
    if len(data) > max_bytes:
        raise HTTPException(413, f"File is too large. Maximum size is {max_bytes // 1024 // 1024} MB.")
    name = safe_name(file.filename or "material" + suffix)
    path = UPLOADS / name
    path.write_bytes(data)
    try:
        text = extract_text(path, suffix)
    except RuntimeError as exc:
        path.unlink(missing_ok=True)
        raise HTTPException(422, str(exc)) from exc
    except Exception as exc:
        path.unlink(missing_ok=True)
        raise HTTPException(422, "The file could not be read. Check that it is a valid, readable document.") from exc
    if not text:
        path.unlink(missing_ok=True)
        raise HTTPException(422, "The document contains no readable text.")
    user = current_user(db)
    m = StudyMaterial(
        user_id=user.id,
        filename=file.filename or name,
        content_type=file.content_type or mimetypes.guess_type(file.filename or "")[0] or "application/octet-stream",
        file_path=str(path.relative_to(ROOT)),
        extracted_text=text,
        size_bytes=len(data),
    )
    db.add(m)
    db.commit()
    db.refresh(m)
    return {**material_out(m), "message": "Material uploaded and processed."}


@app.post("/api/materials/demo")
def create_demo_material(db: Session = Depends(get_db)):
    existing = db.query(StudyMaterial).filter(StudyMaterial.filename == "Lernyqo Demo — Electrochemistry.txt").first()
    if existing:
        return {**material_out(existing), "demo": True, "message": "Demo material already exists."}
    demo_text = """Electrochemistry — Demo Study Notes\n\nElectrochemistry studies the relationship between chemical reactions and electrical energy. Oxidation is loss of electrons, while reduction is gain of electrons. A galvanic cell converts chemical energy into electrical energy through a spontaneous redox reaction. The anode is the site of oxidation and the cathode is the site of reduction. Electrons move through the external circuit from anode to cathode.\n\nKey revision idea: remember OIL RIG — Oxidation Is Loss, Reduction Is Gain. Electrode potential describes the tendency of a species to gain electrons under specified conditions. The Nernst equation relates cell potential to concentration and reaction conditions.\n\nFor an exam, be able to identify oxidation and reduction, locate the anode and cathode, explain electron flow, and connect electrode potential with the conditions described in the notes. These demo notes are intentionally short so a judge can see the complete Lernyqo workflow quickly."""
    user = current_user(db)
    m = StudyMaterial(user_id=user.id, filename="Lernyqo Demo — Electrochemistry.txt", content_type="text/plain", file_path="", extracted_text=demo_text, size_bytes=len(demo_text.encode("utf-8")))
    db.add(m); db.commit(); db.refresh(m)
    return {**material_out(m), "demo": True, "message": "Demo material created."}


@app.delete("/api/materials/{material_id}")
def delete_material(material_id: int, db: Session = Depends(get_db)):
    m = material_or_404(db, material_id)
    p = ROOT / m.file_path if m.file_path else None
    if p and p.exists():
        p.unlink()
    db.delete(m)
    db.commit()
    return {"ok": True}


def cached_content(db: Session, material_id: int, kind: str, count: int | None = None):
    rows = db.query(GeneratedContent).filter(
        GeneratedContent.material_id == material_id,
        GeneratedContent.content_type == kind,
    ).order_by(desc(GeneratedContent.created_at)).all()
    if not rows:
        return None
    latest = rows[0]
    if kind == "flashcards" and count is not None and len(latest.payload.get("cards", [])) != count:
        return None
    return latest.payload


def generate_content(material_id, kind, count, difficulty="mixed", question_type="mixed", db=None, use_cache=False):
    m = material_or_404(db, material_id)
    if use_cache:
        cached = cached_content(db, material_id, kind, count)
        if cached:
            return {"mode": "CACHED", "material_id": m.id, "content": cached}
    try:
        payload, mode = AIService().generate(kind, m.extracted_text, count, difficulty, question_type)
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from exc
    db.add(GeneratedContent(material_id=m.id, content_type=kind, payload=payload))
    db.commit()
    return {"mode": mode, "material_id": m.id, "content": payload}


@app.post("/api/materials/{material_id}/summary")
def summary(material_id: int, db: Session = Depends(get_db)):
    return generate_content(material_id, "summary", 1, db=db, use_cache=True)


@app.post("/api/materials/{material_id}/concepts")
def concepts(material_id: int, db: Session = Depends(get_db)):
    return generate_content(material_id, "concepts", 5, db=db, use_cache=True)


@app.post("/api/materials/{material_id}/flashcards")
def flashcards(material_id: int, body: FlashcardGenerateIn, db: Session = Depends(get_db)):
    return generate_content(material_id, "flashcards", body.count, db=db, use_cache=True)


def quiz_payload(q):
    return {
        "id": q.id,
        "title": q.title,
        "difficulty": q.difficulty,
        "question_count": q.question_count,
        "questions": [
            {
                "id": x.id,
                "position": x.position,
                "question": x.question,
                "options": x.options,
                "topic": x.topic,
                "difficulty": x.difficulty,
            }
            for x in sorted(q.questions, key=lambda z: z.position)
        ],
    }


@app.post("/api/materials/{material_id}/quiz")
def make_quiz(material_id: int, body: QuizGenerateIn, db: Session = Depends(get_db)):
    result = generate_content(material_id, "quiz", body.count, body.difficulty, db=db)
    m = material_or_404(db, material_id)
    questions = result["content"].get("questions", [])
    if len(questions) < 1:
        raise HTTPException(502, "No quiz questions were generated.")
    q = Quiz(material_id=material_id, title=f"{Path(m.filename).stem} Quiz", difficulty=body.difficulty, question_count=len(questions))
    db.add(q)
    db.flush()
    for i, item in enumerate(questions):
        if len(item.get("options", [])) != 4 or not 0 <= int(item.get("correct_answer", -1)) < 4:
            db.rollback()
            raise HTTPException(502, "Generated quiz failed validation.")
        db.add(QuizQuestion(
            quiz_id=q.id, position=i + 1, question=item["question"], options=item["options"],
            correct_answer=int(item["correct_answer"]), explanation=item["explanation"],
            topic=item["topic"], difficulty=item["difficulty"],
        ))
    db.commit()
    db.refresh(q)
    return {"mode": result["mode"], "quiz": quiz_payload(q)}


@app.get("/api/quizzes/{quiz_id}")
def get_quiz(quiz_id: int, db: Session = Depends(get_db)):
    q = db.get(Quiz, quiz_id)
    if not q:
        raise HTTPException(404, "Quiz not found.")
    return quiz_payload(q)


@app.post("/api/quizzes/{quiz_id}/submit")
def submit_quiz(quiz_id: int, body: QuizSubmitIn, db: Session = Depends(get_db)):
    q = db.get(Quiz, quiz_id)
    if not q:
        raise HTTPException(404, "Quiz not found.")
    score = 0
    weak = {}
    results = []
    for qq in sorted(q.questions, key=lambda z: z.position):
        raw = body.answers.get(str(qq.id))
        correct = raw is not None and int(raw) == qq.correct_answer
        if correct:
            score += 1
        else:
            weak[qq.topic] = weak.get(qq.topic, 0) + 1
        results.append({
            "id": qq.id, "question": qq.question, "correct": correct,
            "correct_answer": qq.correct_answer, "explanation": qq.explanation,
            "topic": qq.topic, "selected": raw,
        })
    pct = round(score / len(q.questions) * 100, 1) if q.questions else 0
    attempt = QuizAttempt(quiz_id=q.id, score=score, total=len(q.questions), percentage=pct, weak_topics=sorted(weak, key=weak.get, reverse=True)[:3])
    db.add(attempt)
    db.commit()
    return {"score": score, "total": len(q.questions), "percentage": pct, "weak_topics": attempt.weak_topics, "results": results}


@app.get("/api/mistakes")
def list_mistakes(search: str = "", status: str = "all", topic: str = "", db: Session = Depends(get_db)):
    rows = db.query(Mistake).order_by(desc(Mistake.created_at)).all()
    q = search.strip().lower()
    topic_q = topic.strip().lower()
    out = []
    for x in rows:
        if status == "open" and x.fixed:
            continue
        if status == "fixed" and not x.fixed:
            continue
        if topic_q and topic_q not in (x.topic or "").lower():
            continue
        haystack = f"{x.question} {x.error} {x.fix} {x.subject} {x.topic or ''}".lower()
        if q and q not in haystack:
            continue
        out.append({
            "id": x.id, "question": x.question, "error": x.error, "fix": x.fix,
            "subject": x.subject, "confidence": x.confidence, "topic": x.topic,
            "source_material_id": x.source_material_id, "created_at": x.created_at, "fixed": bool(x.fixed),
        })
    return out


@app.post("/api/mistakes")
def add_mistake(body: MistakeIn, db: Session = Depends(get_db)):
    u = current_user(db)
    if body.source_material_id and not db.get(StudyMaterial, body.source_material_id):
        raise HTTPException(400, "Source material not found.")
    x = Mistake(user_id=u.id, **body.model_dump())
    db.add(x)
    db.commit()
    db.refresh(x)
    return {"id": x.id, "ok": True}


@app.put("/api/mistakes/{mistake_id}")
def update_mistake(mistake_id: int, body: MistakeUpdate, db: Session = Depends(get_db)):
    x = db.get(Mistake, mistake_id)
    if not x:
        raise HTTPException(404, "Mistake not found.")
    for k, v in body.model_dump().items():
        setattr(x, k, v)
    db.commit()
    return {"ok": True}


@app.post("/api/mistakes/{mistake_id}/fixed")
def mark_mistake_fixed(mistake_id: int, db: Session = Depends(get_db)):
    x = db.get(Mistake, mistake_id)
    if not x:
        raise HTTPException(404, "Mistake not found.")
    x.fixed = not bool(x.fixed)
    db.commit()
    return {"ok": True, "fixed": bool(x.fixed)}


@app.delete("/api/mistakes/{mistake_id}")
def delete_mistake(mistake_id: int, db: Session = Depends(get_db)):
    x = db.get(Mistake, mistake_id)
    if not x:
        raise HTTPException(404, "Mistake not found.")
    db.delete(x)
    db.commit()
    return {"ok": True}


@app.get("/api/exams")
def exams(db: Session = Depends(get_db)):
    rows = db.query(Exam).order_by(Exam.exam_date).all()
    return [{"id": x.id, "name": x.name, "exam_date": x.exam_date, "days_remaining": (x.exam_date - date.today()).days} for x in rows]


@app.post("/api/exams")
def add_exam(body: ExamIn, db: Session = Depends(get_db)):
    if body.exam_date < date.today():
        raise HTTPException(400, "Exam date cannot be in the past.")
    u = current_user(db)
    x = Exam(user_id=u.id, **body.model_dump())
    db.add(x)
    db.commit()
    db.refresh(x)
    return {"id": x.id, "ok": True}


@app.put("/api/exams/{exam_id}")
def update_exam(exam_id: int, body: ExamIn, db: Session = Depends(get_db)):
    x = db.get(Exam, exam_id)
    if not x:
        raise HTTPException(404, "Exam not found.")
    if body.exam_date < date.today():
        raise HTTPException(400, "Exam date cannot be in the past.")
    x.name, x.exam_date = body.name, body.exam_date
    db.commit()
    return {"ok": True}


@app.delete("/api/exams/{exam_id}")
def delete_exam(exam_id: int, db: Session = Depends(get_db)):
    x = db.get(Exam, exam_id)
    if not x:
        raise HTTPException(404, "Exam not found.")
    db.delete(x)
    db.commit()
    return {"ok": True}


@app.post("/api/materials/{material_id}/test")
def make_test(material_id: int, body: TestGenerateIn, db: Session = Depends(get_db)):
    result = generate_content(material_id, "test", body.count, body.difficulty, body.question_type, db=db)
    m = material_or_404(db, material_id)
    questions = result["content"].get("questions", [])
    if not questions:
        raise HTTPException(502, "No test questions were generated.")
    payload = {"questions": questions, "mode": result["mode"]}
    t = Test(material_id=material_id, title=f"{Path(m.filename).stem} Practice Test", difficulty=body.difficulty, question_count=len(questions), payload=payload)
    db.add(t)
    db.commit()
    db.refresh(t)
    return {"id": t.id, "title": t.title, "difficulty": t.difficulty, "question_count": t.question_count, "mode": result["mode"], "questions": questions}


@app.get("/api/tests/{test_id}")
def get_test(test_id: int, db: Session = Depends(get_db)):
    t = db.get(Test, test_id)
    if not t:
        raise HTTPException(404, "Test not found.")
    return {"id": t.id, "title": t.title, "difficulty": t.difficulty, "question_count": t.question_count, "mode": t.payload.get("mode", "DEMO MODE"), "questions": t.payload.get("questions", [])}


@app.post("/api/tests/{test_id}/submit")
def submit_test(test_id: int, body: TestSubmitIn, db: Session = Depends(get_db)):
    t = db.get(Test, test_id)
    if not t:
        raise HTTPException(404, "Test not found.")
    answers = body.answers
    qs = t.payload.get("questions", [])
    results = []
    score = 0
    auto_total = 0
    for i, q in enumerate(qs):
        kind = q.get("type", "mcq")
        selected = answers.get(str(i))
        if kind == "mcq":
            auto_total += 1
            correct = selected is not None and int(selected) == int(q.get("correct_answer", -1))
            score += int(correct)
            results.append({"index": i, "type": kind, "correct": correct, "selected": selected, "correct_answer": q.get("correct_answer"), "answer": q.get("answer", ""), "topic": q.get("topic", "General")})
        else:
            results.append({"index": i, "type": kind, "correct": None, "selected": selected, "correct_answer": None, "answer": q.get("answer", ""), "topic": q.get("topic", "General")})
    pct = round(score / auto_total * 100, 1) if auto_total else 0
    db.add(TestAttempt(test_id=t.id, score=score, total_auto_scored=auto_total, percentage=pct))
    db.commit()
    return {"score": score, "auto_scored": auto_total, "total": len(qs), "percentage": pct, "results": results}


@app.get("/api/dashboard")
def dashboard(db: Session = Depends(get_db)):
    materials_count = db.query(StudyMaterial).count()
    flashcards = db.query(GeneratedContent).filter(GeneratedContent.content_type == "flashcards").all()
    quiz_count = db.query(QuizAttempt).count()
    avg = db.query(func.avg(QuizAttempt.percentage)).scalar()
    tests = db.query(Test).count()
    test_attempts = db.query(TestAttempt).count()
    mistakes = db.query(Mistake).count()
    open_mistakes = db.query(Mistake).filter(Mistake.fixed == False).count()  # noqa: E712
    fixed_mistakes = db.query(Mistake).filter(Mistake.fixed == True).count()  # noqa: E712
    exams = db.query(Exam).filter(Exam.exam_date >= date.today()).order_by(Exam.exam_date).all()
    upcoming = exams[0] if exams else None
    material_factor = min(materials_count / 1, 1)
    flash_factor = min(len(flashcards) / 3, 1)
    quiz_factor = min((avg or 0) / 100, 1)
    test_factor = min(test_attempts / 1, 1)
    mistake_factor = 1 if mistakes and fixed_mistakes >= open_mistakes else (0.5 if mistakes else 0)
    readiness = round((material_factor + flash_factor + quiz_factor + test_factor + mistake_factor) / 5 * 100) if materials_count else 0

    if not materials_count:
        next_action = {"title": "Upload your first study material", "detail": "Start the learning loop with a PDF, TXT or Markdown note.", "page": "lab"}
    elif open_mistakes:
        next_action = {"title": f"Review {open_mistakes} open mistake{'s' if open_mistakes != 1 else ''}", "detail": "Your notebook is the best next stop before another test.", "page": "mistakes"}
    elif not quiz_count:
        next_action = {"title": "Take your first quiz", "detail": "Turn your notes into active recall and find weak topics.", "page": "lab"}
    elif upcoming:
        next_action = {"title": f"Prepare for {upcoming.name}", "detail": f"{(upcoming.exam_date - date.today()).days} days remain. Use the preparation timeline.", "page": "exams"}
    else:
        next_action = {"title": "Add your next exam", "detail": "A date turns your activity into a focused revision plan.", "page": "exams"}

    return {
        "materials": materials_count,
        "flashcards": len(flashcards),
        "quizzes": quiz_count,
        "average_quiz_score": round(avg or 0, 1),
        "practice_tests": tests,
        "test_attempts": test_attempts,
        "mistakes": mistakes,
        "open_mistakes": open_mistakes,
        "fixed_mistakes": fixed_mistakes,
        "upcoming_exam": upcoming.name if upcoming else None,
        "days_remaining": (upcoming.exam_date - date.today()).days if upcoming else None,
        "exam_readiness": readiness,
        "next_action": next_action,
    }


app.mount("/", StaticFiles(directory=str(ROOT / "frontend"), html=True), name="frontend")


@app.get("/")
def root():
    return FileResponse(ROOT / "frontend" / "index.html")
