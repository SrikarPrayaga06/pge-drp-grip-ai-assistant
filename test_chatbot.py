"""Comprehensive automated test suite for ArcGIS Chatbot & Session-Level Memory Persistence."""

import os
import sys
import json
import tempfile
import unittest
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from chatbot.arcgis_service import arcgis_service
from chatbot.tools import (
    search_substations,
    search_feeders,
    check_ica_hosting_capacity,
    get_load_profile_summary,
    check_fire_hazard_zone,
    check_grid_deficiencies,
    check_phantom_headroom,
    check_queue_oversubscription,
    check_storage_arbitrage_and_deferral,
    query_layer_direct,
)
from chatbot.agent import ArcGISChatbot

class TestArcGISTools(unittest.TestCase):
    """Test individual abstracted tools against live ArcGIS REST APIs."""

    def test_search_substations(self):
        print("\n[Tool Test 1] Testing search_substations('MISSION')...")
        res_str = search_substations.invoke({"name": "MISSION", "division": "San Francisco", "limit": 2})
        data = json.loads(res_str)
        self.assertGreaterEqual(data["count"], 1)
        sub = data["substations"][0]
        self.assertIn("SF X (MISSION)", sub["name"])
        self.assertEqual(sub["id"], "02201")
        print(f"✓ Found substation: {sub['name']} (ID: {sub['id']}, DG: {sub['existing_dg_kw']} kW)")

    def test_search_feeders(self):
        print("\n[Tool Test 2] Testing search_feeders('022390402')...")
        res_str = search_feeders.invoke({"feeder_id": "022390402", "limit": 1})
        data = json.loads(res_str)
        self.assertGreaterEqual(data["count"], 1)
        feeder = data["feeders"][0]
        self.assertEqual(feeder["feeder_id"], "022390402")
        print(f"✓ Found feeder {feeder['feeder_id']} with total customers: {feeder['customers']['total']}")

    def test_check_ica_hosting_capacity(self):
        print("\n[Tool Test 3] Testing check_ica_hosting_capacity('022390402')...")
        res_str = check_ica_hosting_capacity.invoke({"feeder_id": "022390402", "limit": 2})
        data = json.loads(res_str)
        self.assertEqual(data["status"], "AVAILABLE")
        self.assertGreaterEqual(data["count"], 1)
        sec = data["sections"][0]
        print(f"✓ Section {sec['section']}: Load={sec['load_capacity_kw']} kW, Gen={sec['gen_capacity_kw']} kW, Screen={sec['screen_l']}")

    def test_get_load_profile_summary(self):
        print("\n[Tool Test 4] Testing get_load_profile_summary('feeder', '22390402', month='07')...")
        res_str = get_load_profile_summary.invoke({"target_type": "feeder", "target_id": "22390402", "month": "07"})
        data = json.loads(res_str)
        self.assertEqual(data["target_type"], "feeder")
        self.assertEqual(data["month"], "07")
        self.assertEqual(data["units"], "kW")
        self.assertIsNotNone(data["peak_high"])
        print(f"✓ Feeder July Load: Peak High = {data['peak_high']} kW, Avg High = {data['avg_high']} kW across {data['record_count']} hours")

    def test_check_fire_hazard_zone(self):
        print("\n[Tool Test 5] Testing check_fire_hazard_zone(lon=-122.4194, lat=37.7749)...")
        res_str = check_fire_hazard_zone.invoke({"longitude": -122.4194, "latitude": 37.7749})
        data = json.loads(res_str)
        self.assertFalse(data["in_fire_threat_district"])
        print(f"✓ San Francisco coordinates correctly evaluated: in_fire_threat_district = {data['in_fire_threat_district']}")

    def test_check_phantom_headroom(self):
        print("\n[Tool Test 6] Testing check_phantom_headroom('022390402')...")
        res_str = check_phantom_headroom.invoke({"feeder_id": "022390402"})
        data = json.loads(res_str)
        self.assertIn("verdict", data)
        self.assertIn("assessment", data)
        print(f"✓ Phantom Headroom check: Verdict = {data['verdict']}")

    def test_check_queue_oversubscription(self):
        print("\n[Tool Test 7] Testing check_queue_oversubscription('022390402')...")
        res_str = check_queue_oversubscription.invoke({"feeder_id": "022390402"})
        data = json.loads(res_str)
        self.assertIn("status", data)
        self.assertIn("queue_oversubscription_ratio", data)
        print(f"✓ Queue Oversubscription check: Status = {data['status']}, Ratio = {data['queue_oversubscription_ratio']}")

    def test_check_storage_arbitrage_and_deferral(self):
        print("\n[Tool Test 8] Testing check_storage_arbitrage_and_deferral('022390402')...")
        res_str = check_storage_arbitrage_and_deferral.invoke({"feeder_id": "022390402"})
        data = json.loads(res_str)
        self.assertIn("storage_opportunity_summary", data)
        print(f"✓ Storage Arbitrage & Deferral check: Summary = {data['storage_opportunity_summary'][:80]}...")


class TestChatbotSessionMemory(unittest.TestCase):
    """Test Deep Agent conversational capabilities and SQLite session memory persistence."""

    def setUp(self):
        self.temp_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.temp_db_path = self.temp_db.name
        self.temp_db.close()
        self.bot = ArcGISChatbot(db_path=self.temp_db_path)

    def tearDown(self):
        self.bot.close()
        if os.path.exists(self.temp_db_path):
            try:
                os.unlink(self.temp_db_path)
            except OSError:
                pass

    def test_multi_turn_conversation_and_memory(self):
        print("\n[Agent Test 1] Testing multi-turn conversation and context memory...")
        session_id = "test-session-memory-42"

        # Turn 1: Ask about a specific substation
        turn1_prompt = "Look up the substation named MISSION in San Francisco. What is its Substation ID and existing DG in kW?"
        print(f"Turn 1 Prompt: {turn1_prompt}")
        turn1_reply = self.bot.chat(turn1_prompt, session_id=session_id)
        print(f"Turn 1 Response: {turn1_reply}\n")
        self.assertTrue(any(k in turn1_reply for k in ["02201", "MISSION", "1117"]))

        # Turn 2: Ask a follow-up question referencing the entity without naming it
        turn2_prompt = "What was the name of the substation we were just talking about?"
        print(f"Turn 2 Prompt: {turn2_prompt}")
        turn2_reply = self.bot.chat(turn2_prompt, session_id=session_id)
        print(f"Turn 2 Response: {turn2_reply}\n")
        self.assertTrue("MISSION" in turn2_reply.upper() or "SF X" in turn2_reply.upper())

        # Test history retrieval
        history = self.bot.get_history(session_id)
        self.assertGreaterEqual(len(history), 2)
        print(f"✓ Session history contains {len(history)} messages.")

    def test_session_isolation(self):
        print("\n[Agent Test 2] Testing session isolation across different thread IDs...")
        session_a = "thread-alpha"
        session_b = "thread-beta"

        # Prime Session A with a fact
        self.bot.chat("Remember that my favorite substation is SF X (MISSION).", session_id=session_a)

        # In Session B, ask about favorite substation
        reply_b = self.bot.chat("What is my favorite substation?", session_id=session_b)
        print(f"Session B Response (should not know Session A): {reply_b}\n")
        # Session B should NOT have the fact from Session A
        self.assertNotIn("SF X (MISSION)", reply_b)
        print("✓ Session B was completely isolated from Session A.")

    def test_sqlite_persistence_reload(self):
        print("\n[Agent Test 3] Testing SQLite persistence reload across instance restart...")
        session_id = "persistent-thread-100"

        # Session turn in first bot instance
        self.bot.chat("My project is evaluating feeder 022390402 for solar hosting capacity.", session_id=session_id)
        self.bot.close()

        # Reopen a completely new ArcGISChatbot instance pointing to the same SQLite DB file
        bot_reloaded = ArcGISChatbot(db_path=self.temp_db_path)
        try:
            reload_reply = bot_reloaded.chat("Which feeder did I say I was evaluating for solar hosting capacity?", session_id=session_id)
            print(f"Reloaded Bot Response: {reload_reply}\n")
            self.assertIn("022390402", reload_reply)
            print("✓ Successfully restored session state from SQLite database after reload!")
        finally:
            bot_reloaded.close()


if __name__ == "__main__":
    unittest.main()
