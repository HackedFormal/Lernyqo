from datetime import date
from pydantic import BaseModel, Field, ConfigDict
from typing import Any, Optional

class MaterialOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    filename: str
    content_type: str
    size_bytes: int
    created_at: Any
    extracted_text_available: bool

class MistakeIn(BaseModel):
    question: str = Field(min_length=1, max_length=5000)
    error: str = Field(min_length=1, max_length=5000)
    fix: str = Field(min_length=1, max_length=5000)
    subject: str = Field(min_length=1, max_length=120)
    confidence: str = Field(default="Low", max_length=40)
    topic: Optional[str] = Field(default=None, max_length=255)
    source_material_id: Optional[int] = None
    fixed: bool = False

class MistakeUpdate(MistakeIn):
    pass

class ExamIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    exam_date: date

class QuizGenerateIn(BaseModel):
    difficulty: str = Field(default="mixed", pattern="^(easy|medium|hard|mixed)$")
    count: int = Field(default=5, ge=5, le=20)

class FlashcardGenerateIn(BaseModel):
    count: int = Field(default=10, ge=5, le=20)

class TestGenerateIn(BaseModel):
    difficulty: str = Field(default="mixed", pattern="^(easy|medium|hard|mixed)$")
    count: int = Field(default=5, ge=3, le=15)
    question_type: str = Field(default="mixed", pattern="^(mcq|short|mixed)$")

class QuizSubmitIn(BaseModel):
    answers: dict[str, int]

class TestSubmitIn(BaseModel):
    answers: dict[str, Any]
