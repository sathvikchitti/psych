import requests
import json

BASE_URL = "http://127.0.0.1:7860"

def test_health():
    print("\n[TEST] Health Check...")
    try:
        resp = requests.get(f"{BASE_URL}/health")
        print(f"Status: {resp.status_code}")
        print(f"Body: {resp.json()}")
    except Exception as e:
        print(f"Failed: {e}")

def test_happy_text():
    print("\n[TEST] Happy Text Guardrail...")
    payload = {
        "text": "I feel really good these days. I have been coping up lately and doing well. I am simply living in the moment and enjoying them.",
        "questionnaire": json.dumps({"answers": {}, "scores": {}, "impairment": 30}),
        "userInfo": json.dumps({})
    }
    try:
        resp = requests.post(f"{BASE_URL}/analyze", data=payload)
        data = resp.json()
        print(f"Risk Level: {data['riskLevel']}")
        print(f"Model Prob: {data['modelProb']}%")
        print(f"Guardrail check: {'SUCCESS' if data['riskLevel'] == 'Low' else 'FAILURE'}")
        if 'adet' in data:
            print(f"ADET: {data['adet']} (Should be None)")
    except Exception as e:
        print(f"Failed: {e}")

if __name__ == "__main__":
    # Note: This assumes the server is running locally.
    # If not running, this will fail.
    test_health()
    test_happy_text()
