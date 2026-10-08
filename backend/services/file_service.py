from pathlib import Path
from uuid import uuid4
from pypdf import PdfReader
import mimetypes

ALLOWED = {".pdf", ".txt", ".md", ".jpg", ".jpeg", ".png"}
IMAGE_TYPES = {".jpg", ".jpeg", ".png"}

def safe_name(original: str) -> str:
    suffix = Path(original).suffix.lower()
    stem = "".join(c if c.isalnum() or c in "-_" else "_" for c in Path(original).stem)[:80]
    return f"{uuid4().hex}{('_' + stem) if stem else ''}{suffix}"

def extract_text(path: Path, suffix: str) -> str:
    if suffix == ".pdf":
        reader = PdfReader(str(path))
        return "\n".join((p.extract_text() or "") for p in reader.pages).strip()
    if suffix in {".txt", ".md"}:
        return path.read_text(encoding="utf-8", errors="replace").strip()
    if suffix in IMAGE_TYPES:
        try:
            import pytesseract
            from PIL import Image
            return pytesseract.image_to_string(Image.open(path)).strip()
        except Exception as exc:
            raise RuntimeError("This image requires OCR support that is not currently installed.") from exc
    raise ValueError("Unsupported file type.")
