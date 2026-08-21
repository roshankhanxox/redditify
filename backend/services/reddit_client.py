import praw

from config import settings

_reddit = None


def get_reddit() -> praw.Reddit:
    global _reddit
    if _reddit is None:
        _reddit = praw.Reddit(
            client_id=settings.REDDIT_CLIENT_ID,
            client_secret=settings.REDDIT_CLIENT_SECRET,
            user_agent="ReelBot/1.0",
        )
    return _reddit


def search_posts(query: str, subreddit: str = "all", sort: str = "hot", limit: int = 20) -> list[dict]:
    reddit = get_reddit()
    sub = reddit.subreddit(subreddit)
    results = sub.search(query, sort=sort, limit=limit)
    posts = []
    for post in results:
        # Only text posts with actual content
        if not post.is_self:
            continue
        if post.selftext in ("", "[deleted]", "[removed]"):
            continue
        posts.append({
            "id": post.id,
            "title": post.title,
            "subreddit": post.subreddit.display_name,
            "score": post.score,
            "num_comments": post.num_comments,
            "created_utc": post.created_utc,
            "word_count": len(post.selftext.split()),
            "permalink": f"https://reddit.com{post.permalink}",
        })
    return posts


def fetch_post(post_id: str) -> dict:
    submission = get_reddit().submission(id=post_id)
    return {
        "title": submission.title,
        "body": submission.selftext,
        "subreddit": submission.subreddit.display_name,
        "score": submission.score,
        "author": str(submission.author),
    }


def preprocess_text(body: str, subreddit: str, title: str, max_words: int = 1200) -> str:
    import re
    # Strip markdown links [text](url) → text
    text = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', body)
    # Strip bold/italic
    text = re.sub(r'\*{1,2}([^\*]+)\*{1,2}', r'\1', text)
    # Strip blockquote markers
    text = re.sub(r'^>\s?', '', text, flags=re.MULTILINE)
    # Strip strikethrough
    text = re.sub(r'~~([^~]+)~~', r'\1', text)
    # Collapse multiple newlines
    text = re.sub(r'\n{3,}', '\n\n', text).strip()
    # Prepend context
    intro = f"Posted in r slash {subreddit}. {title}. "
    full = intro + text
    # Truncate
    words = full.split()
    if len(words) > max_words:
        full = " ".join(words[:max_words]) + "..."
    return full
