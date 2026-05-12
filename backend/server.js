const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const { GoogleGenerativeAI } = require("@google/generative-ai");

dotenv.config();

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || "replace-this-secret-before-production";
const MODEL_NAME = process.env.GEMINI_MODEL || "gemini-1.5-flash";
const allowedOrigins = (process.env.CLIENT_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.get("/api/health", cors({ origin: true }), (req, res) => {
  res.json({ ok: true, service: "ai-mock-interview-api" });
});

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true
  })
);
app.use(express.json({ limit: "1mb" }));

mongoose
  .connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/ai_mock_interview")
  .then(() => console.log("MongoDB connected"))
  .catch((error) => console.error("MongoDB connection error:", error.message));

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true }
  },
  { timestamps: true }
);

const interviewSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, required: true },
    experience: { type: String, required: true },
    type: { type: String, required: true },
    skills: [{ type: String }],
    resumeText: { type: String, default: "" },
    questions: [{ type: String }],
    answers: [
      {
        question: String,
        answer: String,
        feedback: mongoose.Schema.Types.Mixed
      }
    ],
    finalReport: mongoose.Schema.Types.Mixed,
    status: { type: String, enum: ["active", "completed"], default: "active" }
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);
const Interview = mongoose.model("Interview", interviewSchema);

function createToken(user) {
  return jwt.sign({ id: user._id, email: user.email }, JWT_SECRET, { expiresIn: "7d" });
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!token) {
    return res.status(401).json({ message: "Authorization token required." });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid or expired session." });
  }
}

function parseJsonFromText(text) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  return JSON.parse(cleaned.slice(start, end + 1));
}

function fallbackQuestions({ role, experience, type, skills }) {
  const skillLine = skills.length ? ` using ${skills.join(", ")}` : "";
  return [
    `Tell me about your background and why you are a strong fit for a ${role} role.`,
    `Describe a recent project where you worked at a ${experience} level${skillLine}.`,
    `How would you approach a challenging ${type.toLowerCase()} interview scenario for this role?`,
    `What is one technical or communication skill you are actively improving?`,
    `Walk me through how you would solve a real business problem as a ${role}.`
  ];
}

async function askGemini(prompt) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: MODEL_NAME });
  const result = await model.generateContent(prompt);
  return result.response.text();
}

async function generateQuestions(payload) {
  const prompt = `
Create 6 mock interview questions as JSON only.
Use this schema: {"questions":["..."]}.
Role: ${payload.role}
Experience: ${payload.experience}
Interview type: ${payload.type}
Skills: ${payload.skills.join(", ") || "Not provided"}
Resume extract: ${payload.resumeText.slice(0, 2500) || "Not uploaded"}
Questions must be specific, realistic, and ordered from warm-up to deeper evaluation.
`;

  try {
    const text = await askGemini(prompt);
    const parsed = parseJsonFromText(text);
    if (Array.isArray(parsed?.questions) && parsed.questions.length) {
      return parsed.questions.slice(0, 8);
    }
  } catch (error) {
    console.warn("Gemini question generation fallback:", error.message);
  }

  return fallbackQuestions(payload);
}

async function evaluateAnswer({ question, answer, role, experience, type }) {
  const prompt = `
Evaluate this mock interview answer as JSON only.
Use schema:
{
  "score": number,
  "confidence": number,
  "clarity": number,
  "technicalAccuracy": number,
  "communication": number,
  "strengths": ["..."],
  "weaknesses": ["..."],
  "improvementTips": ["..."],
  "summary": "..."
}
Scores must be 0-100.
Role: ${role}
Experience: ${experience}
Interview type: ${type}
Question: ${question}
Answer: ${answer}
`;

  try {
    const text = await askGemini(prompt);
    const parsed = parseJsonFromText(text);
    if (parsed?.score !== undefined) return parsed;
  } catch (error) {
    console.warn("Gemini answer evaluation fallback:", error.message);
  }

  const lengthScore = Math.min(95, Math.max(45, Math.round(answer.length / 4)));
  return {
    score: lengthScore,
    confidence: Math.max(40, lengthScore - 7),
    clarity: Math.max(45, lengthScore - 2),
    technicalAccuracy: type === "Technical" ? Math.max(38, lengthScore - 10) : Math.max(50, lengthScore - 4),
    communication: Math.max(45, lengthScore - 1),
    strengths: ["Answer submitted with relevant context.", "Shows willingness to explain the approach."],
    weaknesses: ["Could include sharper examples and measurable outcomes."],
    improvementTips: ["Use the STAR structure.", "Add specific tools, decisions, metrics, and tradeoffs."],
    summary: "Fallback evaluation used because Gemini is not configured or unavailable."
  };
}

function buildFinalReport(interview) {
  const feedbackItems = interview.answers.map((item) => item.feedback).filter(Boolean);
  const average = feedbackItems.length
    ? Math.round(feedbackItems.reduce((sum, item) => sum + Number(item.score || 0), 0) / feedbackItems.length)
    : 0;

  return {
    overallScore: average,
    strengths: [...new Set(feedbackItems.flatMap((item) => item.strengths || []))].slice(0, 5),
    weaknesses: [...new Set(feedbackItems.flatMap((item) => item.weaknesses || []))].slice(0, 5),
    improvementTips: [...new Set(feedbackItems.flatMap((item) => item.improvementTips || []))].slice(0, 6),
    completedAt: new Date()
  };
}

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "ai-mock-interview-api",
    message: "Backend is running. Use /api routes from the frontend."
  });
});

app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email, and password are required." });
    }

    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ message: "Email already registered." });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ name, email, passwordHash });
    res.status(201).json({ token: createToken(user), user: { id: user._id, name: user.name, email: user.email } });
  } catch (error) {
    res.status(500).json({ message: "Registration failed." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ message: "Invalid email or password." });
    }

    res.json({ token: createToken(user), user: { id: user._id, name: user.name, email: user.email } });
  } catch (error) {
    res.status(500).json({ message: "Login failed." });
  }
});

app.get("/api/me", auth, async (req, res) => {
  const user = await User.findById(req.user.id).select("name email");
  res.json({ user });
});

app.post("/api/interviews", auth, upload.single("resume"), async (req, res) => {
  try {
    const { role, experience, type, skills = "" } = req.body;
    if (!role || !experience || !type) {
      return res.status(400).json({ message: "Role, experience, and interview type are required." });
    }

    let resumeText = "";
    if (req.file) {
      const parsed = await pdfParse(req.file.buffer);
      resumeText = parsed.text || "";
    }

    const payload = {
      role,
      experience,
      type,
      skills: skills.split(",").map((skill) => skill.trim()).filter(Boolean),
      resumeText
    };
    const questions = await generateQuestions(payload);
    const interview = await Interview.create({ userId: req.user.id, ...payload, questions });

    res.status(201).json({ interview });
  } catch (error) {
    res.status(500).json({ message: "Could not start interview." });
  }
});

app.post("/api/interviews/:id/answer", auth, async (req, res) => {
  try {
    const { questionIndex, answer } = req.body;
    const interview = await Interview.findOne({ _id: req.params.id, userId: req.user.id });
    if (!interview) return res.status(404).json({ message: "Interview not found." });

    const question = interview.questions[Number(questionIndex)];
    if (!question || !answer) return res.status(400).json({ message: "Question and answer are required." });

    const feedback = await evaluateAnswer({
      question,
      answer,
      role: interview.role,
      experience: interview.experience,
      type: interview.type
    });

    interview.answers.push({ question, answer, feedback });
    await interview.save();
    res.json({ feedback, interview });
  } catch (error) {
    res.status(500).json({ message: "Could not evaluate answer." });
  }
});

app.post("/api/interviews/:id/complete", auth, async (req, res) => {
  const interview = await Interview.findOne({ _id: req.params.id, userId: req.user.id });
  if (!interview) return res.status(404).json({ message: "Interview not found." });

  interview.status = "completed";
  interview.finalReport = buildFinalReport(interview);
  await interview.save();
  res.json({ interview });
});

app.get("/api/interviews", auth, async (req, res) => {
  const interviews = await Interview.find({ userId: req.user.id }).sort({ createdAt: -1 }).limit(20);
  const completed = interviews.filter((item) => item.finalReport?.overallScore !== undefined);
  const averageScore = completed.length
    ? Math.round(completed.reduce((sum, item) => sum + item.finalReport.overallScore, 0) / completed.length)
    : 0;

  res.json({
    interviews,
    analytics: {
      total: interviews.length,
      completed: completed.length,
      averageScore,
      labels: completed.slice(0, 6).reverse().map((item) => item.role),
      scores: completed.slice(0, 6).reverse().map((item) => item.finalReport.overallScore)
    }
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
