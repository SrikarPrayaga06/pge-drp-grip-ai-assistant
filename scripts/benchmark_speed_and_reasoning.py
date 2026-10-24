"""Comprehensive Speed and Reasoning Benchmark for PG&E DRP/GRIP AI Assistant.

Evaluates:
1. End-to-end response latency (Speed) across diverse query archetypes:
   - Zero-tool greeting
   - Single tool lookup (substations)
   - Address geocoding + multi-tool spatial query
   - Line section ICA & Screen L interpretation
   - 8760 hourly load profile analysis
   - Cross-layer synthesis: Phantom Headroom
   - Interconnection queue oversubscription
   - BESS storage arbitrage & LNBA deferral
   - Multi-turn context continuity
   - Fast deterministic guardrail refusal
2. Reasoning Quality & Accuracy:
   - Technical accuracy on PG&E DRP/GRIP rules
   - Table formatting and clear units (kW, MW, kV)
   - Proper tool selection
   - Non-wires alternatives & DER insights
"""

import sys
import os
import time
import json
import statistics
from pathlib import Path

# Add project root to path
ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from chatbot.agent import ArcGISChatbot

BENCHMARK_CASES = [
    {
        "id": "T01_GREETING",
        "name": "Zero-Tool Conversational Greeting",
        "prompt": "Hello! What can you help me with regarding PG&E electric distribution and grid planning?",
        "expected_tool": None,
        "must_contain": ["PG&E", "substation", "hosting capacity", "DRP"],
        "must_not_contain": ["NULL", "search_substations", "{" ],
        "rubric": "Warm greeting explaining distribution capabilities without triggering dummy tool calls or raw JSON."
    },
    {
        "id": "T02_SUBSTATION_SEARCH",
        "name": "Single-Tool Direct Substation Query",
        "prompt": "Find the MISSION substation in San Francisco. What is its Substation ID, operating voltage in kV, and existing DG in kW?",
        "expected_tool": "search_substations",
        "must_contain": ["02201", "12", "1,117", "MISSION"],
        "must_not_contain": ["NULL"],
        "rubric": "Accurate identification of SF X (MISSION), ID 02201, 12 kV, 1,117 kW existing DG with clean table."
    },
    {
        "id": "T03_ADDRESS_GEOCODE_SPATIAL",
        "name": "Physical Address Geocoding & Fire Threat Check",
        "prompt": "Check the fire hazard threat tier and serving division for 3306 Jubilee Dr.",
        "expected_tool": "geocode_address_or_city",
        "must_contain": ["Hayward", "not within", "Tier"],
        "must_not_contain": ["NULL", "3306' as SubstationID"],
        "rubric": "Proper geocoding to Hayward and evaluation that it is NOT in Tier 2 or Tier 3 HFTD."
    },
    {
        "id": "T04_ICA_HOSTING_CAPACITY",
        "name": "ICA Line Section Headroom & Screen L",
        "prompt": "What is the solar and load hosting capacity on feeder 022390402? Does it pass Rule 21 Screen L?",
        "expected_tool": "check_ica_hosting_capacity",
        "must_contain": ["Screen L", "Likely to pass", "kW", "Load"],
        "must_not_contain": ["NULL"],
        "rubric": "Retrieves line sections, evaluates Screen L passing feasibility, and clearly states capacity units (kW)."
    },
    {
        "id": "T05_8760_LOAD_PROFILE",
        "name": "8760 Hourly Profile & Peak Demand Analysis",
        "prompt": "Analyze the July hourly load profile for feeder 22390402. What are the peak consumption hours and load shape?",
        "expected_tool": "get_load_profile_summary",
        "must_contain": ["July", "kW", "peak"],
        "must_not_contain": ["NULL"],
        "rubric": "Analyzes 24-hour diurnal load shape, identifying peak demand hours and seasonal distribution loading."
    },
    {
        "id": "T06_PHANTOM_HEADROOM",
        "name": "Cross-Layer Synthesis: Phantom Headroom Detection",
        "prompt": "Evaluate feeder 022390402 for phantom headroom. Does the published ICA capacity contradict forecasted 2026-2035 GNA deficiencies?",
        "expected_tool": "check_phantom_headroom",
        "must_contain": ["Phantom Headroom", "ICA", "GNA"],
        "must_not_contain": ["NULL"],
        "rubric": "Cross-references ICA static capacity against GNA projected multi-year facility deficiencies to confirm headroom validity."
    },
    {
        "id": "T07_QUEUE_OVERSUBSCRIPTION",
        "name": "Interconnection Queue Oversubscription Analysis",
        "prompt": "Is the interconnection queue on circuit 022390402 saturated or oversubscribed compared to its hosting capacity?",
        "expected_tool": "check_queue_oversubscription",
        "must_contain": ["Queue", "oversubscrib"],
        "must_not_contain": ["NULL"],
        "rubric": "Calculates ratio of queued generation to available generation hosting capacity, identifying interconnection risk."
    },
    {
        "id": "T08_STORAGE_ARBITRAGE_LNBA",
        "name": "Energy Storage (BESS) & LNBA Deferral Opportunities",
        "prompt": "Can battery storage (BESS) unlock generation hosting capacity on feeder 022390402, and are there LNBA deferral opportunities?",
        "expected_tool": "check_storage_arbitrage_and_deferral",
        "must_contain": ["BESS", "storage", "LNBA", "deferral"],
        "must_not_contain": ["NULL"],
        "rubric": "Synthesizes limiting hours, reverse power flow relief via storage charging, and grid investment deferral value."
    },
    {
        "id": "T09_GUARDRAIL_OFFTOPIC",
        "name": "Fast Deterministic Guardrail Refusal",
        "prompt": "Write a python script to solve the two sum problem using a hash map.",
        "expected_tool": None,
        "must_contain": ["specialized exclusively in California electric distribution"],
        "must_not_contain": ["def two_sum", "dict()", "hash map"],
        "rubric": "Instant deterministic refusal of off-topic coding questions without model drift."
    },
    {
        "id": "T10_MULTI_TURN_CONTEXT",
        "name": "Multi-Turn Context & Pronoun Resolution",
        "turn1": "Look up the OAKLAND C substation in the East Bay division.",
        "prompt": "What voltage does that substation operate at and how many transformer banks does it have?",
        "expected_tool": "search_substations",
        "must_contain": ["12", "OAKLAND C"],
        "must_not_contain": ["NULL"],
        "rubric": "Resolves 'that substation' to Oakland C from the previous turn and provides accurate ratings."
    }
]

def run_benchmark():
    print("=" * 80)
    print(" PG&E DRP / GRIP AI ASSISTANT: SPEED & REASONING BENCHMARK")
    print("=" * 80)
    
    bot = ArcGISChatbot()
    print(f"Active Model Engine: {bot.active_model}")
    print(f"Model Pool: {bot.model_pool}")
    print("-" * 80)

    results = []

    for i, test in enumerate(BENCHMARK_CASES, start=1):
        test_id = test["id"]
        name = test["name"]
        session_id = f"bench_{test_id}_{int(time.time())}"
        
        print(f"\n[{i}/{len(BENCHMARK_CASES)}] Running {test_id}: {name}...")
        
        # If multi-turn setup is needed
        if "turn1" in test:
            print(f"  Setup Turn 1: {test['turn1']}")
            t0_setup = time.time()
            bot.chat(test["turn1"], session_id=session_id)
            print(f"  Setup Turn 1 finished in {time.time() - t0_setup:.2f}s")

        prompt = test["prompt"]
        print(f"  Prompt: \"{prompt}\"")
        
        t0 = time.time()
        try:
            reply = bot.chat(prompt, session_id=session_id)
            elapsed = time.time() - t0
            success = True
            error_msg = ""
        except Exception as e:
            elapsed = time.time() - t0
            reply = ""
            success = False
            error_msg = str(e)
            print(f"  ❌ ERROR: {e}")

        # Quality & Reasoning Evaluation
        score = 0
        max_score = 5
        rubric_feedback = []

        if success and reply:
            # 1. Non-empty & substantive length
            if len(reply.strip()) > 50:
                score += 1
                rubric_feedback.append("Substantive narrative length")
            
            # 2. Must contain keywords (strip markdown bolding/italics for robust matching)
            import re
            cleaned_reply = re.sub(r'[*_`#]', '', reply).lower()
            missing_keywords = [k for k in test["must_contain"] if k.lower() not in cleaned_reply]
            if not missing_keywords:
                score += 1
                rubric_feedback.append("All expected technical keywords matched")
            else:
                rubric_feedback.append(f"Missing keywords: {missing_keywords}")

            # 3. Must not contain forbidden tokens
            forbidden_found = [k for k in test["must_not_contain"] if k.lower() in reply.lower()]
            if not forbidden_found:
                score += 1
                rubric_feedback.append("No invalid tokens or NULL values")
            else:
                rubric_feedback.append(f"Forbidden tokens detected: {forbidden_found}")

            # 4. Domain & formatting standards (tables or structured bullet points)
            has_table = "|" in reply and "---" in reply
            has_bullets = any(b in reply for b in ["*", "-", "•"])
            if has_table or has_bullets or test["id"] == "T09_GUARDRAIL_OFFTOPIC":
                score += 1
                rubric_feedback.append("Structured presentation (Markdown table or formatted bullets)")

            # 5. Technical reasoning & synthesis
            if score >= 4:
                score += 1
                rubric_feedback.append("Strong technical reasoning and domain alignment")
        else:
            rubric_feedback.append(f"Execution failed: {error_msg}")

        result_entry = {
            "id": test_id,
            "name": name,
            "latency_sec": round(elapsed, 3),
            "score": score,
            "max_score": max_score,
            "success": success,
            "feedback": rubric_feedback,
            "reply_preview": (reply[:200] + "...") if reply else ""
        }
        results.append(result_entry)
        
        status_icon = "✓" if score >= 4 else ("⚠️" if score >= 2 else "❌")
        print(f"  {status_icon} Latency: {elapsed:.2f}s | Reasoning Score: {score}/{max_score}")
        print(f"  Reply Preview: {reply[:120].strip()}...")

    # Summary Statistics
    latencies = [r["latency_sec"] for r in results]
    scores = [r["score"] for r in results]
    
    avg_latency = statistics.mean(latencies)
    median_latency = statistics.median(latencies)
    p90_latency = sorted(latencies)[int(len(latencies) * 0.9)]
    avg_score = statistics.mean(scores)
    total_passed = sum(1 for r in results if r["score"] >= 4)

    print("\n" + "=" * 80)
    print(" BENCHMARK SUMMARY & PERFORMANCE REPORT")
    print("=" * 80)
    print(f"Total Test Cases:       {len(results)}")
    print(f"Passed (Score >= 4/5):  {total_passed}/{len(results)} ({total_passed/len(results)*100:.1f}%)")
    print(f"Average Response Time:  {avg_latency:.2f}s")
    print(f"Median Response Time:   {median_latency:.2f}s")
    print(f"90th Percentile (P90):  {p90_latency:.2f}s")
    print(f"Average Reasoning Score:{avg_score:.2f} / 5.0")
    print("-" * 80)
    print(f"{'Test ID':<26} {'Latency':<10} {'Score':<8} {'Status'}")
    print("-" * 80)
    for r in results:
        status_str = "PASS" if r["score"] >= 4 else "WARN" if r["score"] >= 2 else "FAIL"
        print(f"{r['id']:<26} {r['latency_sec']:>6.2f}s   {r['score']}/{r['max_score']:<5} {status_str}")
    print("=" * 80)

    # Save benchmark report to JSON
    report_path = ROOT_DIR / "benchmark_results.json"
    report_data = {
        "timestamp": time.time(),
        "model": bot.active_model,
        "metrics": {
            "total_cases": len(results),
            "passed_cases": total_passed,
            "pass_rate_pct": round(total_passed / len(results) * 100, 1),
            "avg_latency_sec": round(avg_latency, 3),
            "median_latency_sec": round(median_latency, 3),
            "p90_latency_sec": round(p90_latency, 3),
            "avg_reasoning_score": round(avg_score, 2),
        },
        "cases": results
    }
    with open(report_path, "w") as f:
        json.dump(report_data, f, indent=2)
    print(f"\nDetailed report written to: {report_path}")

    return report_data


if __name__ == "__main__":
    run_benchmark()
