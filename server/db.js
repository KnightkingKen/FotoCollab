const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Could not connect to database', err);
  } else {
    console.log('Connected to SQLite database');
  }
});

const initialize = () => {
  db.serialize(() => {
    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      password TEXT,
      phone TEXT,
      membership TEXT DEFAULT 'Free',
      storageUsed REAL DEFAULT 0
    )`, () => {
      // Migration: Add missing columns if they don't exist
      const columns = [
        { name: 'isVerified', type: 'INTEGER DEFAULT 0' },
        { name: 'verificationToken', type: 'TEXT' },
        { name: 'googleId', type: 'TEXT' },
        { name: 'facebookId', type: 'TEXT' },
        { name: 'displayName', type: 'TEXT' },
        { name: 'resetToken', type: 'TEXT' },
        { name: 'resetTokenExpiry', type: 'INTEGER' }
      ];

      db.all(`PRAGMA table_info(users)`, (err, rows) => {
        if (err) return;
        const existingColumns = rows.map(r => r.name);
        columns.forEach(col => {
          if (!existingColumns.includes(col.name)) {
            db.run(`ALTER TABLE users ADD COLUMN ${col.name} ${col.type}`);
          }
        });
      });
    });

    // Projects table
    db.run(`CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER,
      name TEXT,
      collaborators INTEGER DEFAULT 1,
      photos INTEGER DEFAULT 0,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users (id)
    )`, () => {
      // Migration: Add timestamps if they don't exist
      const projectColumns = [
        { name: 'createdAt', type: 'DATETIME' },
        { name: 'updatedAt', type: 'DATETIME' }
      ];
      db.all(`PRAGMA table_info(projects)`, (err, rows) => {
        if (err) return;
        const existingColumns = rows.map(r => r.name);
        projectColumns.forEach(col => {
          if (!existingColumns.includes(col.name)) {
            db.run(`ALTER TABLE projects ADD COLUMN ${col.name} ${col.type}`);
          }
        });
      });
    });

    // Files table (was photos)
    db.run(`CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      projectId INTEGER,
      url TEXT,
      name TEXT,
      type TEXT, -- 'image', 'video', 'file'
      size REAL, -- in GB
      orderIndex INTEGER DEFAULT 0,
      FOREIGN KEY (projectId) REFERENCES projects (id)
    )`, () => {
      // Migration: Add orderIndex if it doesn't exist
      db.all(`PRAGMA table_info(files)`, (err, rows) => {
        if (err) return;
        const existingColumns = rows.map(r => r.name);
        if (!existingColumns.includes('orderIndex')) {
          db.run(`ALTER TABLE files ADD COLUMN orderIndex INTEGER DEFAULT 0`);
        }
      });
    });

    // Chat Channels
    db.run(`CREATE TABLE IF NOT EXISTS channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      type TEXT, -- 'public', 'private'
      pin TEXT, -- for private channels
      ownerId INTEGER,
      FOREIGN KEY (ownerId) REFERENCES users (id)
    )`);

    // Channel Members
    db.run(`CREATE TABLE IF NOT EXISTS channel_members (
      channelId INTEGER,
      userId INTEGER,
      PRIMARY KEY (channelId, userId),
      FOREIGN KEY (channelId) REFERENCES channels (id),
      FOREIGN KEY (userId) REFERENCES users (id)
    )`);

    // Chat Messages
    db.run(`CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channelId INTEGER,
      userId INTEGER,
      content TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (channelId) REFERENCES channels (id),
      FOREIGN KEY (userId) REFERENCES users (id)
    )`);

    // Seed initial public channel if none exist
    db.get('SELECT count(*) as count FROM channels WHERE type = "public"', (err, row) => {
      if (row && row.count === 0) {
        db.run('INSERT INTO channels (name, type) VALUES (?, ?)', ['Global Chat', 'public']);
      }
    });
  });
};

initialize();

module.exports = db;
