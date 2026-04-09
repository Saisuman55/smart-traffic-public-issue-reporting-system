import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";

dotenv.config({ override: true });

console.log("Environment Variables Check:");
console.log("- NVIDIA_API_KEY exists:", !!process.env.NVIDIA_API_KEY);
console.log("- API_KEY exists:", !!process.env.API_KEY);
console.log("- MONGODB_URI exists:", !!process.env.MONGODB_URI);
console.log("- MONGODB_DB_NAME exists:", !!process.env.MONGODB_DB_NAME);

const nvidiaApiUrl = "https://integrate.api.nvidia.com/v1/chat/completions";
const nvidiaTextModel = process.env.NVIDIA_TEXT_MODEL || "mistralai/mistral-medium-3-instruct";
const nvidiaMultimodalModel = process.env.NVIDIA_MULTIMODAL_MODEL || "google/gemma-3n-e4b-it";

const mongoUri = process.env.MONGODB_URI;
const mongoDbName = process.env.MONGODB_DB_NAME || "the_civic_authority";

if (!mongoUri) {
  console.warn("MONGODB_URI is not configured. MongoDB-backed data routes will fail until it is set.");
}

const mongoClient = mongoUri ? new MongoClient(mongoUri) : null;
let mongoClientPromise: Promise<MongoClient> | null = null;

async function getDatabase() {
  if (!mongoClient) {
    throw new Error("MongoDB is not configured. Set MONGODB_URI and MONGODB_DB_NAME.");
  }

  if (!mongoClientPromise) {
    mongoClientPromise = mongoClient.connect();
  }

  const client = await mongoClientPromise;
  return client.db(mongoDbName);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function getNvidiaApiKey() {
  return process.env.NVIDIA_API_KEY || process.env.API_KEY;
}

function extractJsonObject(text: string) {
  const trimmed = stripThinking(text).trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("No JSON object found in model response");
    }
    return JSON.parse(match[0]);
  }
}

function stripThinking(text: string) {
  return text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

async function callNvidiaChatCompletion(body: Record<string, unknown>) {
  const apiKey = getNvidiaApiKey();
  if (!apiKey) {
    throw new Error("NVIDIA API key is missing");
  }

  const response = await fetch(nvidiaApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`NVIDIA API request failed: ${response.status} ${text}`);
  }

  return response.json() as Promise<{
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  }>;
}

function sanitizeDocument<T extends Record<string, any>>(document: T | null) {
  if (!document) return null;
  const { _id, ...rest } = document;
  return {
    id: String(_id),
    ...rest,
  };
}

function applyFieldOperations(existing: Record<string, any>, updates: Record<string, any>) {
  const next = clone(existing);

  for (const [key, value] of Object.entries(updates)) {
    if (value && typeof value === "object" && "__op" in value) {
      const current = Array.isArray(next[key]) ? next[key] : [];
      const values = Array.isArray((value as any).values) ? (value as any).values : [];
      const serialized = new Set(current.map((entry: unknown) => JSON.stringify(entry)));

      if ((value as any).__op === "arrayUnion") {
        for (const item of values) {
          const marker = JSON.stringify(item);
          if (!serialized.has(marker)) {
            current.push(item);
            serialized.add(marker);
          }
        }
        next[key] = current;
        continue;
      }

      if ((value as any).__op === "arrayRemove") {
        const removals = new Set(values.map((entry: unknown) => JSON.stringify(entry)));
        next[key] = current.filter((entry: unknown) => !removals.has(JSON.stringify(entry)));
        continue;
      }
    }

    next[key] = value;
  }

  return next;
}

function buildMongoQuery(constraints: any[]) {
  const filter: Record<string, any> = {};
  let order: { field: string; direction: "asc" | "desc" } | null = null;
  let take: number | null = null;
  let startAfter: { id: string; data: Record<string, any> } | null = null;

  for (const constraint of constraints || []) {
    if (constraint.type === "where" && constraint.operator === "==") {
      filter[constraint.field] = constraint.value;
    }

    if (constraint.type === "orderBy") {
      order = {
        field: constraint.field,
        direction: constraint.direction || "asc",
      };
    }

    if (constraint.type === "limit") {
      take = constraint.count;
    }

    if (constraint.type === "startAfter") {
      startAfter = constraint.cursor;
    }
  }

  if (order && startAfter) {
    const cursorValue = startAfter.data?.[order.field];
    if (cursorValue !== undefined) {
      const comparator = order.direction === "desc" ? "$lt" : "$gt";
      filter.$or = [
        { [order.field]: { [comparator]: cursorValue } },
        { [order.field]: cursorValue, _id: { [comparator]: startAfter.id } },
      ];
    }
  }

  const sort = order
    ? { [order.field]: order.direction === "desc" ? -1 : 1, _id: order.direction === "desc" ? -1 : 1 }
    : { _id: -1 };

  return { filter, sort, take };
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "50mb" }));

  app.post("/api/db/get-doc", async (req, res) => {
    try {
      const { collection, id } = req.body;
      const db = await getDatabase();
      const document = await db.collection<any>(collection).findOne({ _id: String(id) });
      res.json({ document: sanitizeDocument(document) });
    } catch (error) {
      console.error("Mongo get-doc error:", error);
      res.status(500).send("Failed to fetch document");
    }
  });

  app.post("/api/db/get-docs", async (req, res) => {
    try {
      const { collection, constraints = [] } = req.body;
      const db = await getDatabase();
      const { filter, sort, take } = buildMongoQuery(constraints);
      let cursor = db.collection<any>(collection).find(filter).sort(sort as any);

      if (take) {
        cursor = cursor.limit(take);
      }

      const documents = (await cursor.toArray()).map(sanitizeDocument);
      res.json({ documents });
    } catch (error) {
      console.error("Mongo get-docs error:", error);
      res.status(500).send("Failed to fetch documents");
    }
  });

  app.post("/api/db/set-doc", async (req, res) => {
    try {
      const { collection, id, data, merge } = req.body;
      const db = await getDatabase();
      const coll = db.collection<any>(collection);
      const documentId = String(id);
      const payload = { ...(data || {}) };

      if (merge) {
        const existing = await coll.findOne({ _id: documentId });
        const merged = applyFieldOperations(existing || {}, payload);
        delete merged._id;
        delete merged.id;
        await coll.updateOne({ _id: documentId }, { $set: { ...merged, id: documentId } }, { upsert: true });
      } else {
        delete payload.id;
        await coll.replaceOne({ _id: documentId }, { _id: documentId, id: documentId, ...payload }, { upsert: true });
      }

      res.json({ ok: true });
    } catch (error) {
      console.error("Mongo set-doc error:", error);
      res.status(500).send("Failed to write document");
    }
  });

  app.post("/api/db/add-doc", async (req, res) => {
    try {
      const { collection, data } = req.body;
      const db = await getDatabase();
      const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
      const payload = { ...(data || {}) };
      delete payload.id;
      await db.collection<any>(collection).insertOne({ _id: id, id, ...payload });
      res.json({ id });
    } catch (error) {
      console.error("Mongo add-doc error:", error);
      res.status(500).send("Failed to create document");
    }
  });

  app.post("/api/db/update-doc", async (req, res) => {
    try {
      const { collection, id, data } = req.body;
      const db = await getDatabase();
      const coll = db.collection<any>(collection);
      const documentId = String(id);
      const existing = await coll.findOne({ _id: documentId });

      if (!existing) {
        return res.status(404).send("Document not found");
      }

      const merged = applyFieldOperations(existing, data || {});
      delete merged._id;
      delete merged.id;
      await coll.updateOne({ _id: documentId }, { $set: { ...merged, id: documentId } });
      res.json({ ok: true });
    } catch (error) {
      console.error("Mongo update-doc error:", error);
      res.status(500).send("Failed to update document");
    }
  });

  app.post("/api/db/delete-doc", async (req, res) => {
    try {
      const { collection, id } = req.body;
      const db = await getDatabase();
      await db.collection<any>(collection).deleteOne({ _id: String(id) });
      res.json({ ok: true });
    } catch (error) {
      console.error("Mongo delete-doc error:", error);
      res.status(500).send("Failed to delete document");
    }
  });

  app.post("/api/db/batch", async (req, res) => {
    try {
      const { operations = [] } = req.body;
      const db = await getDatabase();

      for (const operation of operations) {
        const coll = db.collection<any>(operation.collection);

        if (operation.type === "delete") {
          await coll.deleteOne({ _id: String(operation.id) });
          continue;
        }

        if (operation.type === "update") {
          const existing = await coll.findOne({ _id: String(operation.id) });
          if (!existing) continue;

          const merged = applyFieldOperations(existing, operation.data || {});
          delete merged._id;
          delete merged.id;
          await coll.updateOne({ _id: String(operation.id) }, { $set: { ...merged, id: String(operation.id) } });
        }
      }

      res.json({ ok: true });
    } catch (error) {
      console.error("Mongo batch error:", error);
      res.status(500).send("Failed to commit batch");
    }
  });

  // AI Routes
  app.post("/api/ai/validate", async (req, res) => {
    try {
      const apiKey = getNvidiaApiKey();
      if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
        return res.json({
          isLikelyReal: false,
          confidence: 0,
          reasoning: "AI features are disabled. Please configure your NVIDIA API key.",
          detectedIssue: "Unknown"
        });
      }
      const { image, category, description } = req.body;
      
      const dataUrl = image.startsWith("data:") ? image : `data:image/jpeg;base64,${image}`;
      
      const prompt = `Analyze the image and determine if it depicts a real, genuine civic issue matching the stated category and description.
Category: ${category || "General Civic Issue"}
Description: ${description || "No description provided."}

Return ONLY a valid JSON object. No markdown, no explanation text, no code fences. Just the raw JSON:
{
  "isLikelyReal": boolean,
  "confidence": number (0.0-1.0),
  "reasoning": string (1-3 sentences),
  "detectedIssue": string
}`;

      const response = await callNvidiaChatCompletion({
        model: nvidiaMultimodalModel,
        temperature: 0.2,
        max_tokens: 400,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: {
                  url: dataUrl,
                }
              },
            ],
          },
        ],
      });

      const text = response.choices?.[0]?.message?.content || "{}";
      res.json(extractJsonObject(text));
    } catch (error) {
      console.error("AI Validation Error:", error);
      res.status(500).json({ error: "Validation failed" });
    }
  });

  app.post("/api/ai/chat", async (req, res) => {
    try {
      const apiKey = getNvidiaApiKey();
      if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
        return res.json({ text: "Please configure your NVIDIA API key to enable AI features." });
      }
      
      const { message, history, locationContext } = req.body;
      const response = await callNvidiaChatCompletion({
        model: nvidiaTextModel,
        temperature: 0.4,
        max_tokens: 300,
        messages: [
          {
            role: "system",
            content: `You are "Authority AI" — the intelligent assistant for The Civic Authority.
Role: Efficient, direct, and highly technical civic assistant.
Objective: Provide pinpoint, concise answers. Zero fluff. No conversational filler.
Topics: Issue reporting, status tracking, trust scores, Indian civic rules, app navigation.
Constraint: Max 2-3 sentences per response unless complex instructions are required.
Tone: Professional, robotic efficiency, helpful but brief.
Language: Match user language (English, Hindi, Odia, etc.).${locationContext || ""}`,
          },
          ...((history || []).map((msg: any) => ({
            role: msg.role,
            content: msg.text,
          }))),
          {
            role: "user",
            content: message,
          },
        ],
      });

      res.json({ text: stripThinking(response.choices?.[0]?.message?.content || "") });
    } catch (error) {
      console.error("AI Chat Error:", error);
      res.status(500).json({ error: "Chat failed" });
    }
  });

  app.post("/api/ai/transcribe", async (req, res) => {
    try {
      const apiKey = getNvidiaApiKey();
      if (!apiKey || apiKey === "MY_GEMINI_API_KEY") {
        return res.json({ text: "AI transcription is disabled. Please configure your NVIDIA API key." });
      }
      const { audio } = req.body;
      const prompt = `Transcribe the audio to text. Then clean it into a structured 1-2 sentence civic issue description in English only. Return only the final text with no prefix.`;

      const response = await callNvidiaChatCompletion({
        model: nvidiaMultimodalModel,
        temperature: 0.2,
        max_tokens: 300,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "input_audio",
                input_audio: {
                  data: audio,
                  format: "webm",
                }
              },
            ],
          },
        ],
      });

      res.json({ text: stripThinking(response.choices?.[0]?.message?.content || "") });
    } catch (error) {
      console.error("AI Transcription Error:", error);
      res.status(500).json({ error: "Transcription failed" });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
