import json
import os
import re
from typing import Any

BASE_INSTRUCTIONS = """You are Lernyqo, a study-content transformation engine.
Use the supplied study material as the primary and only factual source.
Do not invent facts or introduce unrelated textbook material.
If the material does not contain enough information, say so clearly in the generated content.
Preserve important formulas, definitions, rules, examples, units, and relationships found in the source.
Make content useful for active recall and exam revision, but do not change the meaning of the source.
Return only the requested structured data.
"""


def _obj(props, required):
    return {"type": "object", "properties": props, "required": required}


class AIService:
    """Gemini Free-tier adapter with a deterministic Demo Mode fallback."""

    def __init__(self):
        self.api_key = os.getenv("GEMINI_API_KEY", "").strip()
        self.demo = os.getenv("DEMO_MODE", "true").lower() == "true" or not self.api_key
        self.model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite")
        self.client = None
        if not self.demo:
            try:
                from google import genai
                self.client = genai.Client(api_key=self.api_key)
            except ImportError as exc:
                raise RuntimeError("Live AI needs the google-genai package. Run START.bat to install it.") from exc

    @property
    def mode(self):
        return "demo" if self.demo else "live"

    def _topic(self, text: str) -> str:
        compact = re.sub(r"\s+", " ", text[:1600]).strip()
        if not compact:
            return "Study material"
        words = [
            w for w in re.findall(r"[A-Za-z][A-Za-z0-9-]{3,}", compact)
            if w.lower() not in {"this", "that", "with", "from", "have", "which", "will", "your", "about", "their", "there", "these"}
        ]
        return " ".join(words[:4]).title() or "Study Material"

    def _source_excerpt(self, text: str) -> str:
        limit = int(os.getenv("MAX_AI_CHARS", "24000"))
        clean = re.sub(r"\n{3,}", "\n\n", text).strip()
        if len(clean) <= limit:
            return clean
        # Keep both the opening context and the end, which often contains examples/formulas.
        head = int(limit * 0.78)
        tail = limit - head
        return clean[:head] + "\n\n[...middle of source omitted for size... ]\n\n" + clean[-tail:]

    def _demo(self, kind: str, text: str, count: int = 5, difficulty: str = "mixed", question_type: str = "mixed"):
        topic = self._topic(text)
        source = self._source_excerpt(text)
        source_sentence = next((s.strip() for s in re.split(r"[.!?]\s+", source) if len(s.strip()) > 40), f"The uploaded material discusses {topic}.")
        if kind == "summary":
            return {
                "summary": f"Demo Mode summary for {topic}: {source_sentence[:420]}",
                "important_points": [
                    f"Review the main ideas presented in the source about {topic}.",
                    "Pay attention to definitions, relationships, examples, and formulas explicitly present in your notes.",
                    "Use active recall after reading instead of rereading passively.",
                ],
                "exam_notes": ["Know the definitions and rules stated in the notes.", "Be able to explain the central idea without looking at the source."],
                "definitions": [{"term": topic, "meaning": "Main topic detected from the uploaded material; confirm the exact definition in your notes."}],
                "formulas": [],
            }
        if kind == "concepts":
            return {"concepts": [
                {"concept": f"{topic} — Core idea", "explanation": f"The source introduces material around {topic}. Revisit the exact explanation in your notes.", "important_rule": "Use the exact rule or relationship stated in the source.", "why_it_matters": "It is a useful anchor for revision."},
                {"concept": f"{topic} — Recall check", "explanation": "Close the notes and explain the idea in your own words.", "important_rule": "Do not rely on recognition alone.", "why_it_matters": "Active recall exposes gaps before the exam."},
            ]}
        if kind == "flashcards":
            seeds = [
                (f"What is the main idea of {topic}?", f"Explain the idea using the wording and evidence in your uploaded material."),
                (f"What definition or rule is important for {topic}?", "Recall the exact definition or rule present in the source."),
                (f"How would you explain {topic} in one minute?", "Give a concise explanation based only on your notes."),
                (f"What example in the notes helps explain {topic}?", "Recall an example explicitly present in the uploaded material."),
                (f"What could an examiner ask about {topic}?", "Turn an important statement from the source into a short-answer question."),
            ]
            return {"cards": [{"question": seeds[i % len(seeds)][0], "answer": seeds[i % len(seeds)][1], "topic": topic} for i in range(count)]}
        if kind == "quiz":
            qs = []
            for i in range(count):
                level = difficulty if difficulty != "mixed" else ["easy", "medium", "hard"][i % 3]
                qs.append({
                    "question": f"Which study action is most appropriate when revising {topic}?",
                    "options": ["Explain the source idea from memory", "Ignore the source", "Use an unrelated topic", "Skip revision entirely"],
                    "correct_answer": 0,
                    "explanation": "Active recall asks you to reconstruct the idea from memory using the uploaded material as the source.",
                    "topic": topic,
                    "difficulty": level,
                })
            return {"questions": qs}
        if kind == "test":
            qs = []
            for i in range(count):
                if question_type == "short" or (question_type == "mixed" and i % 3 == 2):
                    qs.append({"type": "short", "question": f"In 2–3 sentences, explain the central idea of {topic} using your notes.", "options": [], "correct_answer": -1, "answer": "Self-check against the uploaded material and make sure the important relationship or definition is included.", "topic": topic})
                else:
                    qs.append({"type": "mcq", "question": f"Which revision statement is best supported by the Lernyqo study workflow for {topic}?", "options": ["Use the uploaded source to recall and explain the idea", "Replace the source with random information", "Skip the topic", "Memorize an unrelated answer"], "correct_answer": 0, "answer": "Use the uploaded source to recall and explain the idea.", "topic": topic})
            return {"questions": qs}
        raise ValueError("Unknown generation type")

    def _schemas(self):
        return {
            "summary": _obj({
                "summary": {"type": "string"},
                "important_points": {"type": "array", "items": {"type": "string"}},
                "exam_notes": {"type": "array", "items": {"type": "string"}},
                "definitions": {"type": "array", "items": _obj({"term": {"type": "string"}, "meaning": {"type": "string"}}, ["term", "meaning"])},
                "formulas": {"type": "array", "items": {"type": "string"}},
            }, ["summary", "important_points", "exam_notes", "definitions", "formulas"]),
            "concepts": _obj({"concepts": {"type": "array", "items": _obj({
                "concept": {"type": "string"}, "explanation": {"type": "string"}, "important_rule": {"type": "string"}, "why_it_matters": {"type": "string"}
            }, ["concept", "explanation", "important_rule", "why_it_matters"])}}, ["concepts"]),
            "flashcards": _obj({"cards": {"type": "array", "items": _obj({
                "question": {"type": "string"}, "answer": {"type": "string"}, "topic": {"type": "string"}
            }, ["question", "answer", "topic"])}}, ["cards"]),
            "quiz": _obj({"questions": {"type": "array", "items": _obj({
                "question": {"type": "string"},
                "options": {"type": "array", "items": {"type": "string"}, "minItems": 4, "maxItems": 4},
                "correct_answer": {"type": "integer", "minimum": 0, "maximum": 3},
                "explanation": {"type": "string"}, "topic": {"type": "string"}, "difficulty": {"type": "string"}
            }, ["question", "options", "correct_answer", "explanation", "topic", "difficulty"])}}, ["questions"]),
            "test": _obj({"questions": {"type": "array", "items": _obj({
                "type": {"type": "string"}, "question": {"type": "string"},
                "options": {"type": "array", "items": {"type": "string"}},
                "correct_answer": {"type": "integer"}, "answer": {"type": "string"}, "topic": {"type": "string"}
            }, ["type", "question", "options", "correct_answer", "answer", "topic"])}}, ["questions"]),
        }

    def _validate(self, kind: str, payload: Any, count: int):
        if not isinstance(payload, dict):
            raise ValueError("AI returned an invalid object.")
        if kind in {"summary", "concepts", "flashcards", "quiz", "test"} and not payload:
            raise ValueError("AI returned empty content.")
        if kind in {"flashcards", "quiz", "test"}:
            key = {"flashcards": "cards", "quiz": "questions", "test": "questions"}[kind]
            items = payload.get(key)
            if not isinstance(items, list) or not items:
                raise ValueError("AI returned no usable items.")
            if kind == "quiz":
                for q in items:
                    if len(q.get("options", [])) != 4 or not 0 <= int(q.get("correct_answer", -1)) < 4:
                        raise ValueError("AI returned an invalid quiz question.")
            if kind == "test":
                for q in items:
                    if q.get("type") == "mcq" and (len(q.get("options", [])) != 4 or not 0 <= int(q.get("correct_answer", -1)) < 4):
                        raise ValueError("AI returned an invalid test question.")

    def generate(self, kind: str, text: str, count: int = 5, difficulty="mixed", question_type="mixed"):
        if self.demo:
            return self._demo(kind, text, count, difficulty, question_type), "DEMO MODE"
        try:
            from pydantic import BaseModel
            from google.genai import types
        except ImportError as exc:
            raise RuntimeError("Live AI needs google-genai. Run START.bat to install the requirements.") from exc

        prompt = f"""{BASE_INSTRUCTIONS}
TASK: Generate {kind} content.
Count: {count}
Difficulty: {difficulty}
Question type: {question_type}

SOURCE MATERIAL START
{self._source_excerpt(text)}
SOURCE MATERIAL END
"""
        schema = self._schemas()[kind]
        try:
            response = self.client.models.generate_content(
                model=self.model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=schema,
                    temperature=0.2,
                ),
            )
            payload = json.loads(response.text)
            self._validate(kind, payload, count)
            return payload, "LIVE AI"
        except Exception as exc:
            raise RuntimeError(f"Live AI generation failed: {exc}") from exc
