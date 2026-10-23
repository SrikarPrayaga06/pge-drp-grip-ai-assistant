"""Interactive terminal CLI for the ArcGIS DRP / GRIP Chatbot."""

import sys
import uuid
from .agent import ArcGISChatbot

BANNER = """
========================================================================
   ArcGIS DRP / GRIP Electric Distribution Chatbot (Powered by Deep Agents)
========================================================================
 Live connection to PG&E DRP FeatureServer with session-level persistence.
 Commands:
   /session <id>  - Switch to a different session thread
   /history       - View current session conversation history
   /new           - Start a new session
   /tools         - List available grid planning tools
   /exit, /quit   - Exit chatbot
========================================================================
"""

def run_cli():
    print(BANNER)
    print("Initializing Deep Agent with SQLite session memory...")
    try:
        bot = ArcGISChatbot()
        print("✓ Chatbot ready! Running on local LLM (llama3.2).\n")
    except Exception as e:
        print(f"❌ Failed to initialize chatbot: {e}")
        sys.exit(1)

    current_session = f"session-{str(uuid.uuid4())[:8]}"
    print(f"Current session: [{current_session}]\n")

    while True:
        try:
            prompt = input(f"[{current_session}] > ").strip()
            if not prompt:
                continue

            if prompt in ("/exit", "/quit"):
                print("Goodbye!")
                bot.close()
                break

            if prompt == "/new":
                current_session = f"session-{str(uuid.uuid4())[:8]}"
                print(f"Started new session: [{current_session}]\n")
                continue

            if prompt.startswith("/session"):
                parts = prompt.split()
                if len(parts) > 1:
                    current_session = parts[1]
                    print(f"Switched to session: [{current_session}]\n")
                else:
                    print(f"Current session ID: {current_session}\n")
                continue

            if prompt == "/history":
                history = bot.get_history(current_session)
                print(f"\n--- History for [{current_session}] ({len(history)} messages) ---")
                for msg in history:
                    prefix = "User" if msg["role"] == "user" else "Assistant"
                    print(f"{prefix}: {msg['content'][:150]}..." if len(msg['content']) > 150 else f"{prefix}: {msg['content']}")
                print("---------------------------------------------------\n")
                continue

            if prompt == "/tools":
                print("\nAvailable Abstracted Tools:")
                print("  - search_substations: Find substations by name, ID, division, or capacity")
                print("  - search_feeders: Look up distribution feeders and customer counts")
                print("  - check_ica_hosting_capacity: Check ICA load & generation kW hosting capacity")
                print("  - get_load_profile_summary: Retrieve 8760 hourly load profiles and curves")
                print("  - check_fire_hazard_zone: Check CPUC Tier 2/3 High Fire Threat Districts")
                print("  - check_grid_deficiencies: Query GNA deficiencies and LNBA investments")
                print("  - query_layer_direct: Direct SQL query on any ArcGIS layer\n")
                continue

            # Process user message
            print("\nThinking...", end="\r", flush=True)
            response = bot.chat(prompt, session_id=current_session)
            print(" " * 20, end="\r")  # clear thinking message
            print(f"\nAssistant:\n{response}\n")

        except (KeyboardInterrupt, EOFError):
            print("\nExiting. Goodbye!")
            bot.close()
            break
        except Exception as e:
            print(f"\n❌ Error: {e}\n")

if __name__ == "__main__":
    run_cli()
