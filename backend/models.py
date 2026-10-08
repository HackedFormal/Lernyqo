from datetime import datetime, date
from sqlalchemy import Column, Integer, String, Text, DateTime, Date, ForeignKey, Float, JSON, Boolean
from sqlalchemy.orm import relationship
from .database import Base

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    name = Column(String(120), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    materials = relationship("StudyMaterial", back_populates="user")

class StudyMaterial(Base):
    __tablename__ = "study_materials"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    filename = Column(String(255), nullable=False)
    content_type = Column(String(120), nullable=False)
    file_path = Column(String(500), nullable=False)
    extracted_text = Column(Text, nullable=False, default="")
    size_bytes = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    user = relationship("User", back_populates="materials")
    generated = relationship("GeneratedContent", back_populates="material", cascade="all, delete-orphan")
    quizzes = relationship("Quiz", back_populates="material", cascade="all, delete-orphan")
    tests = relationship("Test", back_populates="material", cascade="all, delete-orphan")

class GeneratedContent(Base):
    __tablename__ = "generated_content"
    id = Column(Integer, primary_key=True)
    material_id = Column(Integer, ForeignKey("study_materials.id"), nullable=False)
    content_type = Column(String(40), nullable=False)
    payload = Column(JSON, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    material = relationship("StudyMaterial", back_populates="generated")

class Quiz(Base):
    __tablename__ = "quizzes"
    id = Column(Integer, primary_key=True)
    material_id = Column(Integer, ForeignKey("study_materials.id"), nullable=False)
    title = Column(String(255), nullable=False)
    difficulty = Column(String(20), nullable=False)
    question_count = Column(Integer, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    material = relationship("StudyMaterial", back_populates="quizzes")
    questions = relationship("QuizQuestion", back_populates="quiz", cascade="all, delete-orphan")
    attempts = relationship("QuizAttempt", back_populates="quiz", cascade="all, delete-orphan")

class QuizQuestion(Base):
    __tablename__ = "quiz_questions"
    id = Column(Integer, primary_key=True)
    quiz_id = Column(Integer, ForeignKey("quizzes.id"), nullable=False)
    position = Column(Integer, nullable=False)
    question = Column(Text, nullable=False)
    options = Column(JSON, nullable=False)
    correct_answer = Column(Integer, nullable=False)
    explanation = Column(Text, nullable=False)
    topic = Column(String(255), nullable=False)
    difficulty = Column(String(20), nullable=False)
    quiz = relationship("Quiz", back_populates="questions")

class QuizAttempt(Base):
    __tablename__ = "quiz_attempts"
    id = Column(Integer, primary_key=True)
    quiz_id = Column(Integer, ForeignKey("quizzes.id"), nullable=False)
    score = Column(Integer, nullable=False)
    total = Column(Integer, nullable=False)
    percentage = Column(Float, nullable=False)
    weak_topics = Column(JSON, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    quiz = relationship("Quiz", back_populates="attempts")

class Mistake(Base):
    __tablename__ = "mistakes"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    question = Column(Text, nullable=False)
    error = Column(Text, nullable=False)
    fix = Column(Text, nullable=False)
    subject = Column(String(120), nullable=False)
    confidence = Column(String(40), nullable=False)
    topic = Column(String(255))
    source_material_id = Column(Integer, ForeignKey("study_materials.id"))
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    fixed = Column(Boolean, default=False, nullable=False)

class Test(Base):
    __tablename__ = "tests"
    id = Column(Integer, primary_key=True)
    material_id = Column(Integer, ForeignKey("study_materials.id"), nullable=False)
    title = Column(String(255), nullable=False)
    difficulty = Column(String(20), nullable=False)
    question_count = Column(Integer, nullable=False)
    payload = Column(JSON, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    material = relationship("StudyMaterial", back_populates="tests")

class Exam(Base):
    __tablename__ = "exams"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name = Column(String(255), nullable=False)
    exam_date = Column(Date, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

class TestAttempt(Base):
    __tablename__ = "test_attempts"
    id = Column(Integer, primary_key=True)
    test_id = Column(Integer, ForeignKey("tests.id"), nullable=False)
    score = Column(Integer, nullable=False)
    total_auto_scored = Column(Integer, nullable=False)
    percentage = Column(Float, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
