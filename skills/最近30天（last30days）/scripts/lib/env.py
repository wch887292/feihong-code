"""Environment and API key management for last30days skill."""

import json
import os
from pathlib import Path
from typing import Optional, Dict, Any

# Allow override via environment variable for testing
# Set LAST30DAYS_CONFIG_DIR="" for clean/no-config mode
# Set LAST30DAYS_CONFIG_DIR="/path/to/dir" for custom config location
_config_override = os.environ.get('LAST30DAYS_CONFIG_DIR')
if _config_override == "":
    # Empty string = no config file (clean mode)
    CONFIG_DIR = None
    CONFIG_FILE = None
elif _config_override:
    CONFIG_DIR = Path(_config_override)
    CONFIG_FILE = CONFIG_DIR / ".env"
else:
    CONFIG_DIR = Path.home() / ".config" / "last30days"
    CONFIG_FILE = CONFIG_DIR / ".env"

X_AUTH_ENV_KEYS = ("AUTH_TOKEN", "TWITTER_AUTH_TOKEN", "CT0", "TWITTER_CT0")
_X_AUTH_ALIASES = (("AUTH_TOKEN", "TWITTER_AUTH_TOKEN"), ("CT0", "TWITTER_CT0"))


def load_env_file(path: Path) -> Dict[str, str]:
    """Load environment variables from a file."""
    env = {}
    if not path.exists():
        return env

    with open(path, 'r') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            if '=' in line:
                key, _, value = line.partition('=')
                key = key.strip()
                value = value.strip()
                # Remove quotes if present
                if value and value[0] in ('"', "'") and value[-1] == value[0]:
                    value = value[1:-1]
                if key and value:
                    env[key] = value
    return env


def _export_x_auth_env(config: Dict[str, Any]) -> None:
    """Expose .env X cookie aliases to Bird subprocesses without printing them."""
    for primary, alias in _X_AUTH_ALIASES:
        value = (
            os.environ.get(primary)
            or os.environ.get(alias)
            or config.get(primary)
            or config.get(alias)
        )
        if not value:
            continue
        config[primary] = config.get(primary) or value
        config[alias] = config.get(alias) or value
        os.environ.setdefault(primary, str(value))
        os.environ.setdefault(alias, str(value))


def get_config() -> Dict[str, Any]:
    """Load configuration from ~/.config/last30days/.env and environment."""
    # Load from config file first (if configured)
    file_env = load_env_file(CONFIG_FILE) if CONFIG_FILE else {}

    # Build config: process.env > .env file
    keys = [
        ('OPENAI_API_KEY', None),
        ('XAI_API_KEY', None),
        ('OPENROUTER_API_KEY', None),
        ('PARALLEL_API_KEY', None),
        ('BRAVE_API_KEY', None),
        ('TAVILY_API_KEY', None),
        ('AUTH_TOKEN', None),
        ('TWITTER_AUTH_TOKEN', None),
        ('CT0', None),
        ('TWITTER_CT0', None),
        ('REDDIT_SOURCE', None),
        ('OPENAI_MODEL_POLICY', 'auto'),
        ('OPENAI_MODEL_PIN', None),
        ('XAI_MODEL_POLICY', 'latest'),
        ('XAI_MODEL_PIN', None),
    ]

    config = {}
    for key, default in keys:
        config[key] = os.environ.get(key) or file_env.get(key, default)

    _export_x_auth_env(config)
    return config


def config_exists() -> bool:
    """Check if configuration file exists."""
    return CONFIG_FILE.exists()


def _opencli_available() -> bool:
    """True if the opencli binary is installed (enables Reddit without OpenAI)."""
    import shutil
    return shutil.which("opencli") is not None


def get_available_sources(config: Dict[str, Any]) -> str:
    """Determine which sources are available based on API keys.

    Returns: 'all', 'both', 'reddit', 'reddit-web', 'x', 'x-web', 'web', or 'none'
    """
    # Reddit is available via OpenAI key OR a local opencli install (real browser).
    has_reddit = bool(config.get('OPENAI_API_KEY')) or _opencli_available()
    has_xai = bool(config.get('XAI_API_KEY'))
    from . import bird_x
    has_bird = bird_x.is_bird_installed() and bool(bird_x.is_bird_authenticated())
    has_x = has_xai or has_bird
    has_web = has_web_search_keys(config)

    if has_reddit and has_x:
        return 'all' if has_web else 'both'
    elif has_reddit:
        return 'reddit-web' if has_web else 'reddit'
    elif has_x:
        return 'x-web' if has_web else 'x'
    elif has_web:
        return 'web'
    else:
        return 'web'  # Fallback: assistant WebSearch (no API keys needed)


def has_web_search_keys(config: Dict[str, Any]) -> bool:
    """Check if any web search API keys are configured."""
    return bool(config.get('OPENROUTER_API_KEY') or config.get('PARALLEL_API_KEY') or config.get('BRAVE_API_KEY'))


def get_web_search_source(config: Dict[str, Any]) -> Optional[str]:
    """Determine the best available web search backend.

    Priority: Parallel AI > Brave > OpenRouter/Sonar Pro

    Returns: 'parallel', 'brave', 'openrouter', or None
    """
    if config.get('TAVILY_API_KEY'):
        return 'tavily'
    if config.get('PARALLEL_API_KEY'):
        return 'parallel'
    if config.get('BRAVE_API_KEY'):
        return 'brave'
    if config.get('OPENROUTER_API_KEY'):
        return 'openrouter'
    return None


def get_missing_keys(config: Dict[str, Any]) -> str:
    """Determine which sources are missing (accounting for Bird).

    Returns: 'all', 'both', 'reddit', 'x', 'web', or 'none'
    """
    has_reddit = bool(config.get('OPENAI_API_KEY')) or _opencli_available()
    has_xai = bool(config.get('XAI_API_KEY'))
    has_web = has_web_search_keys(config)

    # Check if Bird provides X access (import here to avoid circular dependency)
    from . import bird_x
    has_bird = bird_x.is_bird_installed() and bird_x.is_bird_authenticated()

    has_x = has_xai or has_bird

    if has_reddit and has_x and has_web:
        return 'none'
    elif has_reddit and has_x:
        return 'web'  # Missing web search keys
    elif has_reddit:
        return 'x'  # Missing X source (and possibly web)
    elif has_x:
        return 'reddit'  # Missing Reddit source (and possibly web)
    else:
        return 'all'  # Missing everything


def _available_has_reddit(available: str) -> bool:
    return available in ('all', 'both', 'reddit', 'reddit-web')


def _available_has_x(available: str) -> bool:
    return available in ('all', 'both', 'x', 'x-web')


def _available_has_web(available: str) -> bool:
    return available in ('all', 'reddit-web', 'x-web', 'web')


def _with_web(source: str, include_web: bool) -> str:
    if not include_web:
        return source
    if source == 'both':
        return 'all'
    if source == 'reddit':
        return 'reddit-web'
    if source == 'x':
        return 'x-web'
    return source


def validate_sources(requested: str, available: str, include_web: bool = False) -> tuple[str, Optional[str]]:
    """Validate requested sources against available keys.

    Args:
        requested: 'auto', 'reddit', 'x', 'both', or 'web'
        available: Result from get_available_sources()
        include_web: If True, add WebSearch to available sources

    Returns:
        Tuple of (effective_sources, error_message)
    """
    # No API keys at all
    if available == 'none':
        if requested == 'auto':
            return 'web', "No API keys configured. The assistant can still search the web if it has a search tool."
        elif requested == 'web':
            return 'web', None
        else:
            return 'web', f"No API keys configured. Add keys to ~/.config/last30days/.env for Reddit/X."

    # Web-only mode (only web search API keys)
    if available == 'web':
        if requested == 'auto':
            return 'web', None
        elif requested == 'web':
            return 'web', None
        else:
            return 'web', f"Only web search keys configured. Add OPENAI_API_KEY for Reddit, XAI_API_KEY for X."

    if requested == 'auto':
        # Add web to sources if include_web is set
        if include_web:
            if available == 'both':
                return 'all', None  # reddit + x + web
            elif available == 'reddit':
                return 'reddit-web', None
            elif available == 'x':
                return 'x-web', None
        return available, None

    if requested == 'web':
        return 'web', None

    if requested == 'both':
        if not (_available_has_reddit(available) and _available_has_x(available)):
            if _available_has_reddit(available):
                missing = "X source"
            elif _available_has_x(available):
                missing = "Reddit source"
            else:
                missing = "Reddit and X sources"
            return 'none', f"Requested both sources but {missing} is missing. Use --sources=auto to use available sources."
        return _with_web('both', include_web), None

    if requested == 'reddit':
        if not _available_has_reddit(available):
            return 'none', "Requested Reddit but no Reddit source is available."
        return _with_web('reddit', include_web), None

    if requested == 'x':
        if not _available_has_x(available):
            return 'none', "Requested X but no X source is available."
        return _with_web('x', include_web), None

    return requested, None


def get_x_source(config: Dict[str, Any]) -> Optional[str]:
    """Determine the best available X/Twitter source.

    Priority: Bird (free) → xAI (paid API)

    Args:
        config: Configuration dict from get_config()

    Returns:
        'bird' if Bird is installed and authenticated,
        'xai' if XAI_API_KEY is configured,
        None if no X source available.
    """
    # Import here to avoid circular dependency
    from . import bird_x

    # Check Bird first (free option)
    if bird_x.is_bird_installed():
        username = bird_x.is_bird_authenticated()
        if username:
            return 'bird'

    # Fall back to xAI if key exists
    if config.get('XAI_API_KEY'):
        return 'xai'

    return None


def is_ytdlp_available() -> bool:
    """Check if yt-dlp is installed for YouTube search."""
    from . import youtube_yt
    return youtube_yt.is_ytdlp_installed()


def get_x_source_status(config: Dict[str, Any]) -> Dict[str, Any]:
    """Get detailed X source status for UI decisions.

    Returns:
        Dict with keys: source, bird_installed, bird_authenticated,
        bird_username, xai_available, can_install_bird
    """
    from . import bird_x

    bird_status = bird_x.get_bird_status()
    xai_available = bool(config.get('XAI_API_KEY'))

    # Determine active source
    if bird_status["authenticated"]:
        source = 'bird'
    elif xai_available:
        source = 'xai'
    else:
        source = None

    return {
        "source": source,
        "bird_installed": bird_status["installed"],
        "bird_authenticated": bird_status["authenticated"],
        "bird_username": bird_status["username"],
        "xai_available": xai_available,
        "can_install_bird": bird_status["can_install"],
    }
