"""运行配置，全部来自环境变量（Docker 部署时由 .env 注入）。"""
import os


def _bool(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


class Settings:
    def __init__(self) -> None:
        self.database_url = os.getenv("DATABASE_URL", "sqlite:///./data/family.db")
        self.secret_key = os.getenv("SECRET_KEY", "dev-insecure-secret-key-change-me-in-production")
        self.token_hours = int(os.getenv("TOKEN_HOURS", "12"))
        self.cookie_secure = _bool("COOKIE_SECURE", False)
        self.media_dir = os.getenv("MEDIA_DIR", "./data/media")
        self.admin_username = os.getenv("ADMIN_USERNAME", "admin")
        self.admin_password = os.getenv("ADMIN_PASSWORD", "admin123")
        self.max_upload_mb = int(os.getenv("MAX_UPLOAD_MB", "5"))
        self.seed_demo = _bool("SEED_DEMO", False)
        self.login_max_failures = int(os.getenv("LOGIN_MAX_FAILURES", "5"))
        self.login_lock_minutes = int(os.getenv("LOGIN_LOCK_MINUTES", "15"))


settings = Settings()
