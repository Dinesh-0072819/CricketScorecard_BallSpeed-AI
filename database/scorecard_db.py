import sqlite3
import os
import datetime

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scorecard.db")

def get_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_scorecard_db():
    conn = get_connection()
    cursor = conn.cursor()
    
    # Matches table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        team1 TEXT NOT NULL,
        team2 TEXT NOT NULL,
        total_overs INTEGER NOT NULL,
        toss_winner TEXT,
        toss_decision TEXT,
        current_innings INTEGER DEFAULT 1,
        target INTEGER DEFAULT 0,
        status TEXT DEFAULT 'LIVE',
        winner TEXT DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    # Batting Scorecard table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS batting_scorecard (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        match_id INTEGER NOT NULL,
        innings_no INTEGER NOT NULL,
        player TEXT NOT NULL,
        runs INTEGER DEFAULT 0,
        balls INTEGER DEFAULT 0,
        fours INTEGER DEFAULT 0,
        sixes INTEGER DEFAULT 0,
        out_desc TEXT DEFAULT 'not out',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(match_id, innings_no, player)
    )
    """)

    # Bowling Scorecard table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS bowling_scorecard (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        match_id INTEGER NOT NULL,
        innings_no INTEGER NOT NULL,
        bowler TEXT NOT NULL,
        balls INTEGER DEFAULT 0,
        maidens INTEGER DEFAULT 0,
        runs INTEGER DEFAULT 0,
        wickets INTEGER DEFAULT 0,
        max_speed REAL DEFAULT 0.0,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(match_id, innings_no, bowler)
    )
    """)

    # Ball-by-Ball table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS ball_by_ball (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        match_id INTEGER NOT NULL,
        innings_no INTEGER NOT NULL,
        over_no INTEGER NOT NULL,
        ball_no INTEGER NOT NULL,
        batsman TEXT NOT NULL,
        bowler TEXT NOT NULL,
        runs INTEGER DEFAULT 0,
        extra_type TEXT DEFAULT NULL,
        wicket TEXT DEFAULT NULL,
        speed_kmh REAL DEFAULT 0.0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    """)

    conn.commit()
    conn.close()

def create_match(team1, team2, total_overs, toss_winner, toss_decision):
    init_scorecard_db()
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO matches (team1, team2, total_overs, toss_winner, toss_decision, current_innings, status)
        VALUES (?, ?, ?, ?, ?, 1, 'LIVE')
    """, (team1, team2, total_overs, toss_winner, toss_decision))
    match_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return match_id

def get_match(match_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM matches WHERE id = ?", (match_id,))
    match = cursor.fetchone()
    conn.close()
    return dict(match) if match else None

def get_all_matches():
    init_scorecard_db()
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM matches ORDER BY id DESC")
    matches = [dict(m) for m in cursor.fetchall()]
    conn.close()
    return matches

def save_batting_stat(match_id, innings_no, player, runs, balls, fours, sixes, out_desc='not out'):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO batting_scorecard (match_id, innings_no, player, runs, balls, fours, sixes, out_desc)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(match_id, innings_no, player) DO UPDATE SET
            runs=excluded.runs,
            balls=excluded.balls,
            fours=excluded.fours,
            sixes=excluded.sixes,
            out_desc=excluded.out_desc,
            updated_at=CURRENT_TIMESTAMP
    """, (match_id, innings_no, player, runs, balls, fours, sixes, out_desc))
    conn.commit()
    conn.close()

def save_bowling_stat(match_id, innings_no, bowler, balls, maidens, runs, wickets, max_speed=0.0):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO bowling_scorecard (match_id, innings_no, bowler, balls, maidens, runs, wickets, max_speed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(match_id, innings_no, bowler) DO UPDATE SET
            balls=excluded.balls,
            maidens=excluded.maidens,
            runs=excluded.runs,
            wickets=excluded.wickets,
            max_speed=MAX(bowling_scorecard.max_speed, excluded.max_speed),
            updated_at=CURRENT_TIMESTAMP
    """, (match_id, innings_no, bowler, balls, maidens, runs, wickets, max_speed))
    conn.commit()
    conn.close()

def log_ball(match_id, innings_no, over_no, ball_no, batsman, bowler, runs, extra_type=None, wicket=None, speed_kmh=0.0):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO ball_by_ball (match_id, innings_no, over_no, ball_no, batsman, bowler, runs, extra_type, wicket, speed_kmh)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (match_id, innings_no, over_no, ball_no, batsman, bowler, runs, extra_type, wicket, speed_kmh))
    conn.commit()
    conn.close()

def delete_last_ball(match_id, innings_no):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        DELETE FROM ball_by_ball WHERE id = (
            SELECT id FROM ball_by_ball WHERE match_id=? AND innings_no=? ORDER BY id DESC LIMIT 1
        )
    """, (match_id, innings_no))
    conn.commit()
    conn.close()

def get_scorecard_details(match_id):
    conn = get_connection()
    cursor = conn.cursor()
    
    cursor.execute("SELECT * FROM matches WHERE id = ?", (match_id,))
    m_row = cursor.fetchone()
    match_info = dict(m_row) if m_row else None

    cursor.execute("SELECT * FROM batting_scorecard WHERE match_id = ? ORDER BY innings_no ASC, id ASC", (match_id,))
    batting = [dict(b) for b in cursor.fetchall()]
    
    cursor.execute("SELECT * FROM bowling_scorecard WHERE match_id = ? ORDER BY innings_no ASC, id ASC", (match_id,))
    bowling = [dict(bw) for bw in cursor.fetchall()]
    
    cursor.execute("SELECT * FROM ball_by_ball WHERE match_id = ? ORDER BY innings_no ASC, id ASC", (match_id,))
    balls = [dict(bl) for bl in cursor.fetchall()]
    
    conn.close()
    return {
        "match": match_info,
        "batting": batting,
        "bowling": bowling,
        "balls": balls
    }

def delete_match(match_id):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM ball_by_ball WHERE match_id = ?", (match_id,))
    cursor.execute("DELETE FROM batting_scorecard WHERE match_id = ?", (match_id,))
    cursor.execute("DELETE FROM bowling_scorecard WHERE match_id = ?", (match_id,))
    cursor.execute("DELETE FROM matches WHERE id = ?", (match_id,))
    conn.commit()
    conn.close()
    return True

def clear_all_matches():
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM ball_by_ball")
    cursor.execute("DELETE FROM batting_scorecard")
    cursor.execute("DELETE FROM bowling_scorecard")
    cursor.execute("DELETE FROM matches")
    conn.commit()
    conn.close()
    return True

def update_match_status(match_id, current_innings=None, target=None, status=None, winner=None):
    conn = get_connection()
    cursor = conn.cursor()
    updates = []
    params = []
    
    if current_innings is not None:
        updates.append("current_innings = ?")
        params.append(current_innings)
    if target is not None:
        updates.append("target = ?")
        params.append(target)
    if status is not None:
        updates.append("status = ?")
        params.append(status)
    if winner is not None:
        updates.append("winner = ?")
        params.append(winner)
        
    if updates:
        params.append(match_id)
        sql = f"UPDATE matches SET {', '.join(updates)} WHERE id = ?"
        cursor.execute(sql, tuple(params))
        conn.commit()
    conn.close()
