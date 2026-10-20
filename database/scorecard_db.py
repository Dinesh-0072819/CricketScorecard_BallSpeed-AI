import sqlite3
import os
import datetime

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scorecard.db")

def get_connection():
    conn = sqlite3.connect(DB_PATH, timeout=20.0)
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

    # Idempotent migration: Add delivery analysis columns if missing
    cursor.execute("PRAGMA table_info(ball_by_ball)")
    existing_cols = {row["name"] for row in cursor.fetchall()}

    analysis_columns = [
        ("delivery_type", "TEXT"),
        ("spin_type", "TEXT"),
        ("swing_type", "TEXT"),
        ("turn_angle_deg", "REAL"),
        ("swing_cm", "REAL"),
        ("bounce_x", "REAL"),
        ("bounce_y", "REAL"),
        ("length", "TEXT"),
        ("line", "TEXT"),
        ("analysis_confidence", "REAL"),
        ("analysis_json", "TEXT")
    ]
    for col_name, col_type in analysis_columns:
        if col_name not in existing_cols:
            cursor.execute(f"ALTER TABLE ball_by_ball ADD COLUMN {col_name} {col_type} DEFAULT NULL")

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

def clear_all_matches():
    init_scorecard_db()
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM matches")
    cursor.execute("DELETE FROM batting_scorecard")
    cursor.execute("DELETE FROM bowling_scorecard")
    cursor.execute("DELETE FROM ball_by_ball")
    try:
        cursor.execute("DELETE FROM sqlite_sequence WHERE name IN ('matches', 'batting_scorecard', 'bowling_scorecard', 'ball_by_ball')")
    except Exception as e:
        pass
    conn.commit()
    conn.close()

def get_all_matches():
    init_scorecard_db()
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM matches ORDER BY id DESC")
    matches = [dict(m) for m in cursor.fetchall()]
    
    for m in matches:
        match_id = m["id"]
        # Innings 1 totals
        cursor.execute("SELECT SUM(runs) as total_runs FROM batting_scorecard WHERE match_id=? AND innings_no=1", (match_id,))
        row_r1 = cursor.fetchone()
        r1 = row_r1["total_runs"] if row_r1 and row_r1["total_runs"] is not None else 0
        
        cursor.execute("SELECT COUNT(*) as w FROM batting_scorecard WHERE match_id=? AND innings_no=1 AND out_desc != 'not out'", (match_id,))
        row_w1 = cursor.fetchone()
        w1 = row_w1["w"] if row_w1 else 0
        
        cursor.execute("SELECT SUM(balls) as b FROM bowling_scorecard WHERE match_id=? AND innings_no=1", (match_id,))
        row_b1 = cursor.fetchone()
        b1 = row_b1["b"] if row_b1 and row_b1["b"] is not None else 0

        # Innings 2 totals
        cursor.execute("SELECT SUM(runs) as total_runs FROM batting_scorecard WHERE match_id=? AND innings_no=2", (match_id,))
        row_r2 = cursor.fetchone()
        r2 = row_r2["total_runs"] if row_r2 and row_r2["total_runs"] is not None else 0
        
        cursor.execute("SELECT COUNT(*) as w FROM batting_scorecard WHERE match_id=? AND innings_no=2 AND out_desc != 'not out'", (match_id,))
        row_w2 = cursor.fetchone()
        w2 = row_w2["w"] if row_w2 else 0
        
        cursor.execute("SELECT SUM(balls) as b FROM bowling_scorecard WHERE match_id=? AND innings_no=2", (match_id,))
        row_b2 = cursor.fetchone()
        b2 = row_b2["b"] if row_b2 and row_b2["b"] is not None else 0

        m["inn1_runs"] = r1
        m["inn1_wickets"] = w1
        m["inn1_overs"] = f"{b1 // 6}.{b1 % 6}"
        
        m["inn2_runs"] = r2
        m["inn2_wickets"] = w2
        m["inn2_overs"] = f"{b2 // 6}.{b2 % 6}"

    conn.close()
    return matches

def save_batting_stat(match_id, innings_no, player, runs, balls, fours, sixes, out_desc='not out'):
    if not match_id:
        return
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
    if not match_id:
        return
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

def log_ball(
    match_id,
    innings_no,
    over_no,
    ball_no,
    batsman,
    bowler,
    runs,
    extra_type=None,
    wicket=None,
    speed_kmh=0.0,
    delivery_type=None,
    spin_type=None,
    swing_type=None,
    turn_angle_deg=None,
    swing_cm=None,
    bounce_x=None,
    bounce_y=None,
    length=None,
    line=None,
    analysis_confidence=None,
    analysis_json=None
):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO ball_by_ball (
            match_id, innings_no, over_no, ball_no, batsman, bowler, runs,
            extra_type, wicket, speed_kmh,
            delivery_type, spin_type, swing_type, turn_angle_deg, swing_cm,
            bounce_x, bounce_y, length, line, analysis_confidence, analysis_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        match_id, innings_no, over_no, ball_no, batsman, bowler, runs,
        extra_type, wicket, speed_kmh,
        delivery_type, spin_type, swing_type, turn_angle_deg, swing_cm,
        bounce_x, bounce_y, length, line, analysis_confidence, analysis_json
    ))
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
    match_row = cursor.fetchone()
    match_dict = dict(match_row) if match_row else None
    
    cursor.execute("SELECT * FROM batting_scorecard WHERE match_id = ? ORDER BY innings_no ASC, id ASC", (match_id,))
    batting = [dict(b) for b in cursor.fetchall()]
    
    cursor.execute("SELECT * FROM bowling_scorecard WHERE match_id = ? ORDER BY innings_no ASC, id ASC", (match_id,))
    bowling = [dict(bw) for bw in cursor.fetchall()]
    
    cursor.execute("SELECT * FROM ball_by_ball WHERE match_id = ? ORDER BY id ASC", (match_id,))
    balls = [dict(bl) for bl in cursor.fetchall()]
    
    conn.close()
    return {
        "match": match_dict,
        "batting": batting,
        "bowling": bowling,
        "balls": balls
    }

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


def get_match_deliveries(match_id):
    """
    Returns all ball deliveries for a given match with ball movement analysis.
    Useful for pitch map visualization and trajectory logging.
    """
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT id, match_id, innings_no, over_no, ball_no, batsman, bowler, runs, extra_type,
               wicket, speed_kmh, delivery_type, spin_type, swing_type, turn_angle_deg,
               swing_cm, bounce_x, bounce_y, length, line, analysis_confidence, analysis_json,
               created_at
        FROM ball_by_ball
        WHERE match_id = ?
        ORDER BY id ASC
    """, (match_id,))
    rows = [dict(r) for r in cursor.fetchall()]
    conn.close()
    return rows


def get_bowler_analysis(match_id=None, bowler_name=None):
    """
    Computes aggregated ball movement analysis metrics across a match (or specific bowler):
    - balls analysed
    - average turn angle
    - average swing deviation
    - spin vs swing delivery counts
    - length distribution
    - average speed
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    query = "SELECT * FROM ball_by_ball WHERE delivery_type IS NOT NULL"
    params = []
    if match_id is not None:
        query += " AND match_id = ?"
        params.append(match_id)
    if bowler_name is not None:
        query += " AND bowler = ?"
        params.append(bowler_name)
    query += " ORDER BY id ASC"

    cursor.execute(query, tuple(params))
    balls = [dict(r) for r in cursor.fetchall()]
    conn.close()

    total_analysed = len(balls)
    if total_analysed == 0:
        return {
            "balls_analysed": 0,
            "avg_turn_deg": 0.0,
            "avg_swing_cm": 0.0,
            "avg_speed_kmh": 0.0,
            "spin_count": 0,
            "swing_count": 0,
            "straight_count": 0,
            "delivery_counts": {
                "OFF_SPIN": 0, "LEG_SPIN": 0, "INSWING": 0, "OUTSWING": 0, "STRAIGHT": 0
            },
            "length_distribution": {
                "Yorker": 0, "Full": 0, "Good Length": 0, "Short": 0, "Full Toss": 0
            },
            "line_distribution": {
                "Outside Off": 0, "Off Stump": 0, "Middle Stump": 0, "Leg Stump": 0, "Down Leg": 0
            },
            "bowlers": {}
        }

    turn_values = [b["turn_angle_deg"] for b in balls if b.get("turn_angle_deg") is not None and b["turn_angle_deg"] > 0]
    swing_values = [b["swing_cm"] for b in balls if b.get("swing_cm") is not None and b["swing_cm"] > 0]
    speed_values = [b["speed_kmh"] for b in balls if b.get("speed_kmh") is not None and b["speed_kmh"] > 0]

    delivery_counts = {"OFF_SPIN": 0, "LEG_SPIN": 0, "INSWING": 0, "OUTSWING": 0, "STRAIGHT": 0}
    length_distribution = {"Yorker": 0, "Full": 0, "Good Length": 0, "Short": 0, "Full Toss": 0}
    line_distribution = {"Outside Off": 0, "Off Stump": 0, "Middle Stump": 0, "Leg Stump": 0, "Down Leg": 0}
    bowlers_map = {}

    for b in balls:
        dt = b.get("delivery_type") or "STRAIGHT"
        if dt in delivery_counts:
            delivery_counts[dt] += 1
        else:
            delivery_counts[dt] = delivery_counts.get(dt, 0) + 1

        l_val = b.get("length")
        if l_val in length_distribution:
            length_distribution[l_val] += 1

        line_val = b.get("line")
        if line_val in line_distribution:
            line_distribution[line_val] += 1

        # Per bowler breakdown
        bw_name = b.get("bowler", "Unknown")
        if bw_name not in bowlers_map:
            bowlers_map[bw_name] = {
                "balls": 0,
                "turns": [],
                "swings": [],
                "speeds": [],
                "deliveries": {}
            }
        bw_entry = bowlers_map[bw_name]
        bw_entry["balls"] += 1
        if b.get("turn_angle_deg"): bw_entry["turns"].append(b["turn_angle_deg"])
        if b.get("swing_cm"): bw_entry["swings"].append(b["swing_cm"])
        if b.get("speed_kmh"): bw_entry["speeds"].append(b["speed_kmh"])
        bw_entry["deliveries"][dt] = bw_entry["deliveries"].get(dt, 0) + 1

    # Summarize per bowler
    bowlers_summary = {}
    for name, data in bowlers_map.items():
        bowlers_summary[name] = {
            "balls_analysed": data["balls"],
            "avg_turn_deg": round(sum(data["turns"]) / len(data["turns"]), 2) if data["turns"] else 0.0,
            "avg_swing_cm": round(sum(data["swings"]) / len(data["swings"]), 1) if data["swings"] else 0.0,
            "avg_speed_kmh": round(sum(data["speeds"]) / len(data["speeds"]), 1) if data["speeds"] else 0.0,
            "delivery_counts": data["deliveries"]
        }

    spin_count = delivery_counts["OFF_SPIN"] + delivery_counts["LEG_SPIN"]
    swing_count = delivery_counts["INSWING"] + delivery_counts["OUTSWING"]

    return {
        "balls_analysed": total_analysed,
        "avg_turn_deg": round(sum(turn_values) / len(turn_values), 2) if turn_values else 0.0,
        "avg_swing_cm": round(sum(swing_values) / len(swing_values), 1) if swing_values else 0.0,
        "avg_speed_kmh": round(sum(speed_values) / len(speed_values), 1) if speed_values else 0.0,
        "spin_count": spin_count,
        "swing_count": swing_count,
        "straight_count": delivery_counts.get("STRAIGHT", 0),
        "delivery_counts": delivery_counts,
        "length_distribution": length_distribution,
        "line_distribution": line_distribution,
        "bowlers": bowlers_summary
    }

