from database.scorecard_db import (
    create_match, get_match, save_batting_stat, save_bowling_stat, log_ball,
    delete_last_ball, update_match_status, get_scorecard_details
)

class MatchEngine:
    def __init__(self, match_id=None):
        self.match_id = match_id
        self.team1 = ""
        self.team2 = ""
        self.total_overs = 20
        self.toss_winner = ""
        self.toss_decision = "BAT"
        
        self.current_innings = 1
        self.target = 0
        self.status = "LIVE"
        self.winner = ""
        
        self.runs = 0
        self.wickets = 0
        self.balls = 0
        
        self.striker = ""
        self.non_striker = ""
        self.bowler = ""
        
        self.batting = {}   # player -> {runs, balls, fours, sixes, out_desc}
        self.bowling = {}   # bowler -> {balls, maidens, runs, wickets, runsInCurrentOver, max_speed}
        
        self.over_deliveries = [] # list of icons/strings in current over
        self.runs_this_over = 0
        self.history = []   # stack for undo operations
        
        if match_id:
            self.load_match(match_id)

    def start_new_match(self, team1, team2, total_overs, toss_winner, toss_decision, batting_team_name=""):
        self.team1 = team1
        self.team2 = team2
        self.total_overs = int(total_overs)
        self.toss_winner = toss_winner
        self.toss_decision = toss_decision
        self.match_id = create_match(team1, team2, self.total_overs, toss_winner, toss_decision)
        return self.match_id

    def setup_innings(self, striker, non_striker, bowler, target=0, current_innings=1):
        self.current_innings = current_innings
        self.target = target
        self.striker = striker
        self.non_striker = non_striker
        self.bowler = bowler
        
        self.runs = 0
        self.wickets = 0
        self.balls = 0
        self.over_deliveries = []
        self.runs_this_over = 0
        
        self.batting[striker] = {"runs": 0, "balls": 0, "fours": 0, "sixes": 0, "out_desc": "not out"}
        self.batting[non_striker] = {"runs": 0, "balls": 0, "fours": 0, "sixes": 0, "out_desc": "not out"}
        self.bowling[bowler] = {"balls": 0, "maidens": 0, "runs": 0, "wickets": 0, "runsInCurrentOver": 0, "max_speed": 0.0}
        
        self._sync_db()

    def load_match(self, match_id):
        m = get_match(match_id)
        if not m:
            return False
        self.match_id = m["id"]
        self.team1 = m["team1"]
        self.team2 = m["team2"]
        self.total_overs = m["total_overs"]
        self.toss_winner = m["toss_winner"]
        self.toss_decision = m["toss_decision"]
        self.current_innings = m["current_innings"]
        self.target = m["target"]
        self.status = m["status"]
        self.winner = m["winner"]
        return True

    def swap_batsmen(self):
        self.striker, self.non_striker = self.non_striker, self.striker

    def record_delivery(self, mode="NORMAL", runs=0, wicket_desc=None, new_batsman=None, who_out=None, speed_kmh=0.0):
        """
        mode: 'NORMAL', 'WIDE', 'NOBALL', 'LB', 'BYE', 'WICKET', 'RUN_WICKET'
        """
        if self.status == "COMPLETED":
            return {"error": "Match already completed"}

        # Snapshot for undo
        snapshot = self._take_snapshot()

        is_legal_ball = True
        extra_type = None
        wicket_flag = None
        runs_added = 0
        
        # Ensure bowler state
        if self.bowler not in self.bowling:
            self.bowling[self.bowler] = {"balls": 0, "maidens": 0, "runs": 0, "wickets": 0, "runsInCurrentOver": 0, "max_speed": 0.0}
        bw = self.bowling[self.bowler]
        if speed_kmh > bw["max_speed"]:
            bw["max_speed"] = float(speed_kmh)

        if mode == "NORMAL":
            runs_added = runs
            self.runs += runs
            self.balls += 1
            bw["balls"] += 1
            bw["runs"] += runs
            bw["runsInCurrentOver"] += runs
            
            # Batter stats
            bs = self._get_batter(self.striker)
            bs["balls"] += 1
            bs["runs"] += runs
            if runs == 4: bs["fours"] += 1
            if runs == 6: bs["sixes"] += 1

            if runs % 2 != 0:
                self.swap_batsmen()
                
            self.over_deliveries.append(self._runs_icon(runs))

        elif mode in ("LB", "BYE"):
            runs_added = runs
            extra_type = mode
            self.runs += runs
            self.balls += 1
            bw["balls"] += 1
            bw["runsInCurrentOver"] += runs
            
            bs = self._get_batter(self.striker)
            bs["balls"] += 1
            
            if runs % 2 != 0:
                self.swap_batsmen()
            self.over_deliveries.append(f"{mode}{runs}")

        elif mode == "WIDE":
            is_legal_ball = False
            extra_type = "Wide"
            runs_added = 1 + runs
            self.runs += runs_added
            bw["runs"] += runs_added
            bw["runsInCurrentOver"] += runs_added
            
            if runs % 2 != 0:
                self.swap_batsmen()
            self.over_deliveries.append(f"Wd+{runs}")

        elif mode == "NOBALL":
            is_legal_ball = False
            extra_type = "No Ball"
            runs_added = 1 + runs
            self.runs += runs_added
            bw["runs"] += runs_added
            bw["runsInCurrentOver"] += runs_added
            
            if runs > 0:
                bs = self._get_batter(self.striker)
                bs["runs"] += runs
                if runs == 4: bs["fours"] += 1
                if runs == 6: bs["sixes"] += 1
                
            if runs % 2 != 0:
                self.swap_batsmen()
            self.over_deliveries.append(f"NB+{runs}")

        elif mode in ("WICKET", "RUN_WICKET"):
            runs_added = runs
            wicket_flag = "W"
            self.runs += runs
            self.balls += 1
            self.wickets += 1
            bw["balls"] += 1
            bw["runs"] += runs
            bw["runsInCurrentOver"] += runs
            bw["wickets"] += 1

            out_player = who_out if who_out else self.striker
            out_bs = self._get_batter(out_player)
            out_bs["out_desc"] = wicket_desc or "out"
            out_bs["balls"] += 1
            out_bs["runs"] += runs

            if runs % 2 != 0:
                self.swap_batsmen()

            # Handle new batsman replacement
            if new_batsman:
                if out_player == self.striker:
                    self.striker = new_batsman
                else:
                    self.non_striker = new_batsman
                self._get_batter(new_batsman)

            self.over_deliveries.append(f"{runs}+W" if runs > 0 else "W")

        self.runs_this_over += runs_added

        # Database Logging
        over_num = (self.balls // 6) + 1 if is_legal_ball else ((self.balls - 1) // 6) + 1
        ball_num = (self.balls % 6) if (self.balls % 6 != 0) else 6
        log_ball(
            match_id=self.match_id,
            innings_no=self.current_innings,
            over_no=max(1, over_num),
            ball_no=ball_num,
            batsman=self.striker,
            bowler=self.bowler,
            runs=runs_added,
            extra_type=extra_type,
            wicket=wicket_flag,
            speed_kmh=speed_kmh
        )

        self._sync_db()
        self.history.append(snapshot)

        # Check Over End
        over_completed = False
        if is_legal_ball and (self.balls % 6 == 0):
            over_completed = True
            if bw["runsInCurrentOver"] == 0:
                bw["maidens"] += 1
            bw["runsInCurrentOver"] = 0
            self.over_deliveries = []
            self.runs_this_over = 0
            self.swap_batsmen() # End of over strike rotation

        self._check_match_completion()
        return self.get_state(over_completed=over_completed)

    def undo(self):
        if not self.history:
            return {"error": "No history to undo"}
        last_state = self.history.pop()
        self._restore_snapshot(last_state)
        delete_last_ball(self.match_id, self.current_innings)
        self._sync_db()
        return self.get_state()

    def set_next_bowler(self, new_bowler):
        self.bowler = new_bowler
        if new_bowler not in self.bowling:
            self.bowling[new_bowler] = {"balls": 0, "maidens": 0, "runs": 0, "wickets": 0, "runsInCurrentOver": 0, "max_speed": 0.0}

    def _get_batter(self, name):
        if name not in self.batting:
            self.batting[name] = {"runs": 0, "balls": 0, "fours": 0, "sixes": 0, "out_desc": "not out"}
        return self.batting[name]

    def _runs_icon(self, r):
        if r == 0: return "•"
        if r == 4: return "4"
        if r == 6: return "6"
        return str(r)

    def _check_match_completion(self):
        max_balls = self.total_overs * 6
        if self.current_innings == 1:
            if self.wickets >= 10 or self.balls >= max_balls:
                self.target = self.runs + 1
                update_match_status(self.match_id, current_innings=2, target=self.target)
        elif self.current_innings == 2:
            if self.runs >= self.target:
                self.status = "COMPLETED"
                chasing_team = self.team2 if self.toss_decision == "BAT" else self.team1
                self.winner = f"{chasing_team} won by {10 - self.wickets} wickets"
                update_match_status(self.match_id, status="COMPLETED", winner=self.winner)
            elif self.wickets >= 10 or self.balls >= max_balls:
                self.status = "COMPLETED"
                defending_team = self.team1 if self.toss_decision == "BAT" else self.team2
                margin = (self.target - 1) - self.runs
                if margin == 0:
                    self.winner = "Match Tied"
                else:
                    self.winner = f"{defending_team} won by {margin} runs"
                update_match_status(self.match_id, status="COMPLETED", winner=self.winner)

    def _sync_db(self):
        for player, stats in self.batting.items():
            save_batting_stat(
                self.match_id, self.current_innings, player,
                stats["runs"], stats["balls"], stats["fours"], stats["sixes"], stats["out_desc"]
            )
        for bowler, stats in self.bowling.items():
            save_bowling_stat(
                self.match_id, self.current_innings, bowler,
                stats["balls"], stats["maidens"], stats["runs"], stats["wickets"], stats["max_speed"]
            )

    def _take_snapshot(self):
        import copy
        return {
            "runs": self.runs,
            "wickets": self.wickets,
            "balls": self.balls,
            "striker": self.striker,
            "non_striker": self.non_striker,
            "bowler": self.bowler,
            "batting": copy.deepcopy(self.batting),
            "bowling": copy.deepcopy(self.bowling),
            "over_deliveries": list(self.over_deliveries),
            "runs_this_over": self.runs_this_over,
            "status": self.status,
            "winner": self.winner,
            "target": self.target
        }

    def _restore_snapshot(self, snap):
        self.runs = snap["runs"]
        self.wickets = snap["wickets"]
        self.balls = snap["balls"]
        self.striker = snap["striker"]
        self.non_striker = snap["non_striker"]
        self.bowler = snap["bowler"]
        self.batting = snap["batting"]
        self.bowling = snap["bowling"]
        self.over_deliveries = snap["over_deliveries"]
        self.runs_this_over = snap["runs_this_over"]
        self.status = snap["status"]
        self.winner = snap["winner"]
        self.target = snap["target"]

    def get_state(self, over_completed=False):
        overs_formatted = f"{self.balls // 6}.{self.balls % 6}"
        crr = round((self.runs / (self.balls / 6.0)), 2) if self.balls > 0 else 0.0
        
        remaining_balls = (self.total_overs * 6) - self.balls
        remaining_runs = self.target - self.runs if self.target > 0 else 0
        rrr = round((remaining_runs / (remaining_balls / 6.0)), 2) if (remaining_balls > 0 and self.current_innings == 2) else 0.0

        return {
            "match_id": self.match_id,
            "team1": self.team1,
            "team2": self.team2,
            "total_overs": self.total_overs,
            "current_innings": self.current_innings,
            "runs": self.runs,
            "wickets": self.wickets,
            "balls": self.balls,
            "overs": overs_formatted,
            "crr": crr,
            "rrr": rrr,
            "target": self.target,
            "remaining_runs": max(0, remaining_runs),
            "remaining_balls": max(0, remaining_balls),
            "striker": self.striker,
            "non_striker": self.non_striker,
            "bowler": self.bowler,
            "batting": self.batting,
            "bowling": self.bowling,
            "over_deliveries": self.over_deliveries,
            "over_completed": over_completed,
            "status": self.status,
            "winner": self.winner
        }
