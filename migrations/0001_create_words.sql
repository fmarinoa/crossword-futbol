CREATE TABLE words (
  id TEXT PRIMARY KEY,
  answer TEXT NOT NULL,
  clue TEXT NOT NULL,
  category TEXT NOT NULL,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard'))
);

CREATE INDEX idx_words_difficulty ON words (difficulty);
CREATE INDEX idx_words_category ON words (category);
