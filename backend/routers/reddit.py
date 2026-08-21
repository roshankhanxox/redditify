from fastapi import APIRouter, Depends, HTTPException, Query

from security import get_current_user
from services import reddit_client

router = APIRouter(prefix="/reddit", tags=["reddit"])


@router.get("/search")
def search(
    q: str = Query(..., min_length=1),
    subreddit: str = "all",
    sort: str = Query("hot", pattern="^(hot|top|new|rising)$"),
    limit: int = Query(20, ge=1, le=50),
    _user=Depends(get_current_user),
):
    # Sync def on purpose: PRAW is blocking; FastAPI runs this in its threadpool.
    try:
        return reddit_client.search_posts(query=q, subreddit=subreddit, sort=sort, limit=limit)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Reddit search failed: {exc}")


@router.get("/post/{post_id}")
def get_post(post_id: str, _user=Depends(get_current_user)):
    try:
        return reddit_client.fetch_post(post_id)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Reddit fetch failed: {exc}")
