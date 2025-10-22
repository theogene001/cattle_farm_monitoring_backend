/*
ESP32 Example: Poll device commands, handle 'control' payload and acknowledge commands.
- Polls GET /api/v1/device/commands?device_id=<id>
- Expects JSON array of commands: { id, command_type, payload }
- For command_type === 'control' payload: { soundEnabled: bool, lightsEnabled: bool }
- On processing, calls POST /api/v1/device/commands/<id>/ack with { status: 'done' }

Notes:
- Uses WiFiClientSecure for HTTPS
- Device authenticates using header 'x-api-key' with its device_api_key
- Adjust pins SOUND_PIN and LIGHT_PIN to match your hardware
- This sketch keeps polling every POLL_INTERVAL_MS
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>

// ----- Configuration -----
const char* ssid = "YOUR_CURRENT_SSID"; // used to initially connect
const char* password = "YOUR_CURRENT_PASSWORD";
const char* serverHost = "your-backend.example.com"; // no protocol here
const int serverPort = 443;
const char* deviceApiKey = "REPLACE_WITH_DEVICE_API_KEY"; // stored on device
const long POLL_INTERVAL_MS = 15000; // 15s

// Hardware pins
const int SOUND_PIN = 25; // example GPIO for speaker/relay
const int LIGHT_PIN = 26; // example GPIO for light/relay

WiFiClientSecure client;

void setup() {
  Serial.begin(115200);
  pinMode(SOUND_PIN, OUTPUT);
  pinMode(LIGHT_PIN, OUTPUT);
  digitalWrite(SOUND_PIN, LOW);
  digitalWrite(LIGHT_PIN, LOW);

  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  int attempt = 0;
  while (WiFi.status() != WL_CONNECTED && attempt < 20) {
    delay(500);
    Serial.print('.');
    attempt++;
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("WiFi connected");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("WiFi failed to connect");
  }

  // IMPORTANT: for production, pin the server certificate or use fingerprint validation.
  client.setInsecure(); // Accept all certs (DEV ONLY)
}

String httpGet(const String& path) {
  String result;
  if (!client.connect(serverHost, serverPort)) {
    Serial.println("Connection failed");
    return result;
  }
  String req = String("GET ") + path + " HTTP/1.1\r\n";
  req += String("Host: ") + serverHost + "\r\n";
  req += String("Connection: close\r\n");
  req += String("x-api-key: ") + deviceApiKey + "\r\n";
  req += "\r\n";

  client.print(req);
  unsigned long timeout = millis();
  while (client.connected() && millis() - timeout < 5000) {
    while (client.available()) {
      String line = client.readStringUntil('\n');
      // skip headers until empty line
      if (line == "\r") {
        // read the body
        String body;
        while (client.available()) {
          body += client.readString();
        }
        result = body;
        break;
      }
    }
  }
  client.stop();
  return result;
}

bool httpPostJson(const String& path, const String& jsonPayload) {
  bool ok = false;
  if (!client.connect(serverHost, serverPort)) {
    Serial.println("Connection failed");
    return false;
  }
  String req = String("POST ") + path + " HTTP/1.1\r\n";
  req += String("Host: ") + serverHost + "\r\n";
  req += String("Content-Type: application/json\r\n");
  req += String("Content-Length: ") + jsonPayload.length() + "\r\n";
  req += String("x-api-key: ") + deviceApiKey + "\r\n";
  req += "Connection: close\r\n\r\n";
  req += jsonPayload;

  client.print(req);
  unsigned long timeout = millis();
  while (client.connected() && millis() - timeout < 5000) {
    while (client.available()) {
      String line = client.readStringUntil('\n');
      // Look for HTTP/1.1 200
      if (line.indexOf("HTTP/1.1 200") >= 0 || line.indexOf("HTTP/1.1 201") >= 0) {
        ok = true;
      }
      if (line == "\r") {
        // headers done; optionally read body
        String body;
        while (client.available()) body += client.readString();
        Serial.println("POST response body:");
        Serial.println(body);
        break;
      }
    }
  }
  client.stop();
  return ok;
}

void applyControl(bool soundOn, bool lightsOn) {
  Serial.printf("applyControl: sound=%d lights=%d\n", soundOn, lightsOn);
  digitalWrite(SOUND_PIN, soundOn ? HIGH : LOW);
  digitalWrite(LIGHT_PIN, lightsOn ? HIGH : LOW);
}

void processCommands(const String& json) {
  if (json.length() == 0) return;
  StaticJsonDocument<4096> doc;
  DeserializationError err = deserializeJson(doc, json);
  if (err) {
    Serial.print("Failed to parse JSON: ");
    Serial.println(err.f_str());
    return;
  }
  if (!doc.is<JsonArray>()) {
    Serial.println("Expected JSON array of commands");
    return;
  }
  for (JsonObject cmd : doc.as<JsonArray>()) {
    const char* type = cmd["command_type"] | "";
    int id = cmd["id"] | 0;
    JsonObject payload = cmd["payload"].as<JsonObject>();
    if (strcmp(type, "control") == 0) {
      bool sound = payload["soundEnabled"] | false;
      bool lights = payload["lightsEnabled"] | false;
      applyControl(sound, lights);
      // acknowledge
      StaticJsonDocument<200> ack;
      ack["status"] = "done";
      String out;
      serializeJson(ack, out);
      String path = String("/api/v1/device/commands/") + id + "/ack";
      bool ok = httpPostJson(path, out);
      Serial.printf("Ack command %d: %s\n", id, ok ? "OK" : "FAIL");
    } else if (strcmp(type, "wifi_update") == 0) {
      // For wifi_update we expect the device to call a credentials endpoint to fetch decrypted credentials securely
      Serial.println("Received wifi_update command (handled separately)");
      // Acknowledge so the server knows device saw the command; optionally trigger fetch of credentials here
      StaticJsonDocument<200> ack;
      ack["status"] = "received";
      String out;
      serializeJson(ack, out);
      String path = String("/api/v1/device/commands/") + id + "/ack";
      httpPostJson(path, out);
    } else {
      Serial.printf("Unknown command type: %s\n", type);
    }
  }
}

void loop() {
  // Poll commands for this device (device_id should be known server-side mapping to api key)
  String path = String("/api/v1/device/commands?device_id=") + String("YOUR_DEVICE_ID");
  String response = httpGet(path);
  Serial.println("Polled commands response:");
  Serial.println(response);
  processCommands(response);

  delay(POLL_INTERVAL_MS);
}
