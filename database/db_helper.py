import datetime
from pymongo import MongoClient
from config import Config

def get_db():
    # Use 2-second timeout so it never hangs if MongoDB is offline or misconfigured
    client = MongoClient(
        Config.MONGO_URI,
        serverSelectionTimeoutMS=2000,
        connectTimeoutMS=2000,
        socketTimeoutMS=2000
    )
    return client[Config.MONGO_DB_NAME]

def init_db():
    """Verify the connection to MongoDB and ensure indexes are created."""
    try:
        db = get_db()
        # Force connection verification
        db.client.admin.command('ping')
        # Create an index on 'id' descending to optimize retrieval
        db.runs.create_index([("id", -1)])
        print("MongoDB initialized and connected successfully.")
    except Exception as e:
        print(f"MongoDB initialization error: {e}")

def add_run(speed, status):
    """Insert a new bowling run record using auto-incremented integer ID."""
    try:
        db = get_db()
        runs_collection = db.runs
        
        # Get the next sequence ID
        max_run = runs_collection.find_one(sort=[("id", -1)])
        next_id = (max_run["id"] + 1) if max_run else 1
        
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        doc = {
            "id": next_id,
            "speed": float(speed),
            "status": status,
            "timestamp": timestamp
        }
        
        runs_collection.insert_one(doc)
        print(f"Logged run to MongoDB: {speed} km/h ({status})")
    except Exception as e:
        print(f"Failed to add run to MongoDB: {e}")

def get_runs(limit=50):
    """Retrieve runs from MongoDB ordered by newest first."""
    try:
        db = get_db()
        runs_collection = db.runs
        
        cursor = runs_collection.find().sort("id", -1).limit(limit)
        
        runs_list = []
        for r in cursor:
            runs_list.append({
                "id": r.get("id"),
                "speed": r.get("speed"),
                "status": r.get("status"),
                "timestamp": r.get("timestamp")
            })
        return runs_list
    except Exception as e:
        print(f"Failed to get runs from MongoDB: {e}")
        return []
