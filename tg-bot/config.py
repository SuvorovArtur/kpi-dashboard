import os
from dotenv import load_dotenv

load_dotenv()

# Telegram API (https://my.telegram.org)
TG_API_ID = int(os.getenv('TG_API_ID', '0'))
TG_API_HASH = os.getenv('TG_API_HASH', '')
TG_SESSION = os.getenv('TG_SESSION', 'socpulse_bot')

# Supabase
SUPABASE_URL = os.getenv('SUPABASE_URL', 'https://dwrpellubzpjblmffmqv.supabase.co')
SUPABASE_KEY = os.getenv('SUPABASE_KEY', '')

# DeepSeek
DEEPSEEK_API_KEY = os.getenv('DEEPSEEK_API_KEY', '')
DEEPSEEK_MODEL = 'deepseek-chat'

# Analysis settings
BATCH_SIZE = 100  # messages per analysis batch
ANALYSIS_INTERVAL = 1800  # seconds between analysis runs (30 min)
