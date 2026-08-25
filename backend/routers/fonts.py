import os

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, RedirectResponse

from config import settings
from security import get_current_user
from services import fonts as fonts_service
from services.storage import is_s3

router = APIRouter(tags=["fonts"])


@router.get("/fonts")
async def list_fonts(user=Depends(get_current_user)):
    """Display-font registry — same TTFs the Pillow renderer uses."""
    return fonts_service.list_fonts()


@router.get("/fonts/{font_id}/file")
async def font_file(font_id: str, user=Depends(get_current_user)):
    """Serve the actual TTF so the browser preview renders identical metrics.
    Whitelist-guarded: ids are [a-z0-9-]+ and must exist in the scan."""
    path = fonts_service.get_font_path(font_id)
    if path is None:
        raise HTTPException(404, detail="Unknown font")
    if is_s3():
        raise HTTPException(501, detail="Fonts are served from the API filesystem")
    if not os.path.exists(path):
        raise HTTPException(404, detail="Font file missing")
    return FileResponse(
        path,
        media_type="font/ttf",
        headers={"Cache-Control": "public, max-age=86400"},
    )
