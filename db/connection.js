const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        role VARCHAR(20) DEFAULT 'client' CHECK (role IN ('admin', 'client')),
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS modules (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        icon VARCHAR(10) DEFAULT '📚',
        cover_image TEXT,
        order_position INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );
      DO $$ BEGIN
        ALTER TABLE modules ADD COLUMN IF NOT EXISTS cover_image TEXT;
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$;
      DO $$ BEGIN
        ALTER TABLE modules ADD COLUMN IF NOT EXISTS is_bonus BOOLEAN DEFAULT FALSE;
        ALTER TABLE modules ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE;
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$;
      CREATE TABLE IF NOT EXISTS lessons (
        id SERIAL PRIMARY KEY,
        module_id INTEGER REFERENCES modules(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        content_type VARCHAR(20) NOT NULL CHECK (content_type IN ('video', 'pdf', 'link')),
        content_url TEXT NOT NULL,
        thumbnail TEXT,
        duration VARCHAR(20),
        order_position INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );
      DO $$ BEGIN
        ALTER TABLE lessons ADD COLUMN IF NOT EXISTS thumbnail TEXT;
        ALTER TABLE lessons ADD COLUMN IF NOT EXISTS duration VARCHAR(20);
        ALTER TABLE lessons ADD COLUMN IF NOT EXISTS is_locked BOOLEAN DEFAULT FALSE;
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$;
      CREATE TABLE IF NOT EXISTS app_settings (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMP DEFAULT NOW()
      );
      INSERT INTO app_settings (key, value) VALUES ('checkout_url', 'https://wa.me/5491136109797?text=Hola%20Juan%2C%20quiero%20acceso%20al%20curso%20Setter%20con%20IA')
        ON CONFLICT (key) DO NOTHING;
      INSERT INTO app_settings (key, value) VALUES ('intro_video_url', '')
        ON CONFLICT (key) DO NOTHING;
      INSERT INTO app_settings (key, value) VALUES ('intro_gate_enabled', 'false')
        ON CONFLICT (key) DO NOTHING;
      CREATE TABLE IF NOT EXISTS resources (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        file_url TEXT NOT NULL,
        resource_type VARCHAR(20) NOT NULL CHECK (resource_type IN ('pdf', 'link')),
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS user_progress (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        lesson_id INTEGER REFERENCES lessons(id) ON DELETE CASCADE,
        completed BOOLEAN DEFAULT FALSE,
        completed_at TIMESTAMP,
        UNIQUE(user_id, lesson_id)
      );

      -- Notifications system
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        message TEXT,
        type VARCHAR(30) DEFAULT 'system',
        read BOOLEAN DEFAULT FALSE,
        data JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- YouTube channel monitoring
      CREATE TABLE IF NOT EXISTS youtube_channels (
        id SERIAL PRIMARY KEY,
        channel_id VARCHAR(100) UNIQUE NOT NULL,
        channel_name VARCHAR(255),
        last_video_id VARCHAR(50),
        last_checked_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- AI config (future)
      CREATE TABLE IF NOT EXISTS ai_config (
        id SERIAL PRIMARY KEY,
        key VARCHAR(100) UNIQUE NOT NULL,
        value JSONB,
        updated_at TIMESTAMP DEFAULT NOW()
      );

      -- Plans
      CREATE TABLE IF NOT EXISTS plans (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        order_position INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Add plan config columns
      DO $$ BEGIN ALTER TABLE plans ADD COLUMN IF NOT EXISTS duration_months INTEGER DEFAULT 1; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
      DO $$ BEGIN ALTER TABLE plans ADD COLUMN IF NOT EXISTS has_discord BOOLEAN DEFAULT FALSE; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
      DO $$ BEGIN ALTER TABLE plans ADD COLUMN IF NOT EXISTS has_bot BOOLEAN DEFAULT FALSE; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
      DO $$ BEGIN ALTER TABLE plans ADD COLUMN IF NOT EXISTS bot_message_limit INTEGER DEFAULT 300; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
      DO $$ BEGIN ALTER TABLE plans ADD COLUMN IF NOT EXISTS bot_credential_software_id INTEGER; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
      DO $$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS access_type VARCHAR(20) DEFAULT 'full'; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
      DO $$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS closer_notes TEXT DEFAULT ''; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
      DO $$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(50) DEFAULT ''; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
      DO $$ BEGIN ALTER TABLE plans ADD COLUMN IF NOT EXISTS allowed_modules JSONB DEFAULT '[]'; EXCEPTION WHEN duplicate_column THEN NULL; END $$;

      -- Add plan_id and expires_at to users
      DO $$ BEGIN
        ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_id INTEGER REFERENCES plans(id);
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$;
      DO $$ BEGIN
        ALTER TABLE users ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP;
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$;

      -- Discord OAuth fields
      DO $$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_id TEXT; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
      DO $$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_joined_at TIMESTAMP; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
      DO $$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_expired BOOLEAN DEFAULT FALSE; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
      DO $$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_intermediate BOOLEAN DEFAULT FALSE; EXCEPTION WHEN duplicate_column THEN NULL; END $$;

      -- Softwares catalog
      CREATE TABLE IF NOT EXISTS softwares (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        download_url TEXT,
        tutorial_url TEXT,
        icon VARCHAR(10) DEFAULT '💻',
        order_position INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );

      -- Add links JSONB to softwares for multiple custom links (global)
      DO $$ BEGIN
        ALTER TABLE softwares ADD COLUMN IF NOT EXISTS links JSONB DEFAULT '[]';
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$;

      -- Which softwares each plan includes
      CREATE TABLE IF NOT EXISTS plan_softwares (
        plan_id INTEGER REFERENCES plans(id) ON DELETE CASCADE,
        software_id INTEGER REFERENCES softwares(id) ON DELETE CASCADE,
        PRIMARY KEY (plan_id, software_id)
      );

      -- Per-user credentials for each software
      CREATE TABLE IF NOT EXISTS user_credentials (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        software_id INTEGER REFERENCES softwares(id) ON DELETE CASCADE,
        username VARCHAR(255),
        password VARCHAR(255),
        extra_info TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, software_id)
      );

      -- Add links JSONB to user_credentials for per-user dynamic links
      DO $$ BEGIN
        ALTER TABLE user_credentials ADD COLUMN IF NOT EXISTS links JSONB DEFAULT '[]';
      EXCEPTION WHEN duplicate_column THEN NULL;
      END $$;

      -- Bot clients (managed from admin, validated by bot extension)
      CREATE TABLE IF NOT EXISTS bot_clients (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(255) DEFAULT '',
        plan VARCHAR(50) DEFAULT 'custom',
        message_limit INTEGER DEFAULT 300,
        messages_sent INTEGER DEFAULT 0,
        last_reset_date DATE DEFAULT CURRENT_DATE,
        is_active BOOLEAN DEFAULT TRUE,
        expiry_date TIMESTAMP NOT NULL,
        notes TEXT DEFAULT '',
        created_by VARCHAR(50) DEFAULT 'admin',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS bot_daily_stats (
        id SERIAL PRIMARY KEY,
        bot_client_id INTEGER REFERENCES bot_clients(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        message_count INTEGER DEFAULT 0,
        UNIQUE(bot_client_id, date)
      );

      CREATE INDEX IF NOT EXISTS idx_bot_clients_email ON bot_clients(email);
      CREATE INDEX IF NOT EXISTS idx_bot_clients_expiry ON bot_clients(expiry_date);
      CREATE INDEX IF NOT EXISTS idx_bot_daily_stats_date ON bot_daily_stats(bot_client_id, date);

      -- Onboarding + approval fields on users
      DO $$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT FALSE; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
      DO $$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_step INTEGER DEFAULT 0; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
      DO $$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS approved BOOLEAN DEFAULT FALSE; EXCEPTION WHEN duplicate_column THEN NULL; END $$;
      DO $$ BEGIN ALTER TABLE users ADD COLUMN IF NOT EXISTS rejected BOOLEAN DEFAULT FALSE; EXCEPTION WHEN duplicate_column THEN NULL; END $$;

      -- Contract signatures
      CREATE TABLE IF NOT EXISTS contracts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        full_name VARCHAR(255) NOT NULL,
        address TEXT NOT NULL,
        document_id VARCHAR(100) NOT NULL,
        payment_date DATE NOT NULL,
        currency VARCHAR(10) NOT NULL DEFAULT 'USD',
        amount NUMERIC(12,2) NOT NULL,
        ip_address VARCHAR(50),
        signed_at TIMESTAMP DEFAULT NOW()
      );

      -- Payment proofs (multiple per user)
      CREATE TABLE IF NOT EXISTS payment_proofs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        file_url TEXT NOT NULL,
        original_name VARCHAR(255),
        uploaded_at TIMESTAMP DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_contracts_user ON contracts(user_id);
      CREATE INDEX IF NOT EXISTS idx_payment_proofs_user ON payment_proofs(user_id);

      -- Weekly check-ins
      CREATE TABLE IF NOT EXISTS weekly_checkins (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        week_start DATE NOT NULL,
        calls INTEGER DEFAULT 0,
        clients_closed INTEGER DEFAULT 0,
        revenue NUMERIC(12,2) DEFAULT 0,
        notes TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, week_start)
      );
      CREATE INDEX IF NOT EXISTS idx_checkins_user ON weekly_checkins(user_id, week_start DESC);

      -- Monthly goals
      CREATE TABLE IF NOT EXISTS monthly_goals (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        month DATE NOT NULL,
        revenue_goal NUMERIC(12,2) DEFAULT 0,
        clients_goal INTEGER DEFAULT 0,
        notes TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, month)
      );
      CREATE INDEX IF NOT EXISTS idx_goals_user ON monthly_goals(user_id, month DESC);

      -- Action logs (diario)
      CREATE TABLE IF NOT EXISTS action_logs (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        date DATE DEFAULT CURRENT_DATE,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_action_logs_user ON action_logs(user_id, date DESC);

      -- Expiry reminders tracking
      CREATE TABLE IF NOT EXISTS expiry_reminders_sent (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        days_before INTEGER NOT NULL,
        sent_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, days_before)
      );

      -- Call tracking
      CREATE TABLE IF NOT EXISTS call_tracking (
        id SERIAL PRIMARY KEY,
        closer_id INTEGER REFERENCES users(id),
        event_id VARCHAR(255) UNIQUE,
        client_name VARCHAR(255) DEFAULT '',
        client_email VARCHAR(255) DEFAULT '',
        client_phone VARCHAR(100) DEFAULT '',
        result VARCHAR(20) NOT NULL DEFAULT 'pending',
        amount NUMERIC(12,2) DEFAULT 0,
        notes TEXT DEFAULT '',
        call_date TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_call_tracking_date ON call_tracking(call_date);

      -- Performance indices
      CREATE INDEX IF NOT EXISTS idx_lessons_module_id ON lessons(module_id);
      CREATE INDEX IF NOT EXISTS idx_user_progress_user ON user_progress(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_progress_lesson ON user_progress(lesson_id);
      CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);
      CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
    `);

    // Create admin user if not exists
    const bcrypt = require('bcryptjs');
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@setterconia.com';
    const adminPass = process.env.ADMIN_PASSWORD || 'Admin123!';
    const existing = await client.query('SELECT id FROM users WHERE email = $1', [adminEmail]);
    if (existing.rows.length === 0) {
      const hash = await bcrypt.hash(adminPass, 12);
      await client.query(
        'INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)',
        [adminEmail, hash, 'Administrador', 'admin']
      );
      console.log(`Admin user created: ${adminEmail}`);
    }
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };
