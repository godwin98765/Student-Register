import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { randomInt } from "node:crypto";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST,OPTIONS"
};
const response = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
const required = ["fullName", "email", "mobile", "courseId"];
const validStatuses = new Set(["Submitted"]);

export const handler = async (event) => {
  if (event.requestContext?.http?.method === "OPTIONS") return { statusCode: 204, headers, body: "" };
  try {
    const input = JSON.parse(event.body || "{}");
    const missing = required.filter((field) => !String(input[field] || "").trim());
    if (missing.length) return response(400, { success: false, message: `Missing required fields: ${missing.join(", ")}` });

    const email = String(input.email).trim().toLowerCase();
    const mobile = String(input.mobile).replace(/\D/g, "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return response(400, { success: false, message: "Enter a valid email address." });
    if (!/^[6-9]\d{9}$/.test(mobile)) return response(400, { success: false, message: "Enter a valid 10-digit Indian mobile number." });

    const course = await db.send(new GetCommand({ TableName: process.env.COURSES_TABLE, Key: { courseId: input.courseId } }));
    if (!course.Item || !course.Item.active) return response(400, { success: false, message: "This programme is not available for applications." });
    if (course.Item.applicationDeadline && new Date(course.Item.applicationDeadline) < new Date()) {
      return response(400, { success: false, message: "The application deadline for this programme has passed." });
    }

    const duplicates = await db.send(new ScanCommand({
      TableName: process.env.APPLICATIONS_TABLE,
      FilterExpression: "courseId = :courseId AND (email = :email OR mobile = :mobile)",
      ExpressionAttributeValues: { ":courseId": input.courseId, ":email": email, ":mobile": mobile },
      ProjectionExpression: "applicationId"
    }));
    if ((duplicates.Items || []).length) return response(409, { success: false, message: "An application already exists for this programme." });

    const now = new Date().toISOString();
    const applicationId = `SSMIET-${new Date().getUTCFullYear()}-${randomInt(100000, 1000000)}`;
    const application = {
      applicationId,
      fullName: String(input.fullName).trim(),
      email,
      mobile,
      alternateMobile: String(input.alternateMobile || "").replace(/\D/g, ""),
      dateOfBirth: String(input.dateOfBirth || ""),
      gender: String(input.gender || ""),
      address: String(input.address || ""),
      previousInstitution: String(input.previousInstitution || ""),
      registerNumber: String(input.registerNumber || ""),
      department: String(input.department || ""),
      year: String(input.year || ""),
      semester: String(input.semester || ""),
      cgpaOrPercentage: String(input.cgpaOrPercentage || ""),
      guardianName: String(input.guardianName || ""),
      guardianMobile: String(input.guardianMobile || "").replace(/\D/g, ""),
      preferredBatch: String(input.preferredBatch || ""),
      learningMode: String(input.learningMode || ""),
      courseId: course.Item.courseId,
      courseName: course.Item.courseName,
      status: "Submitted",
      createdAt: now,
      updatedAt: now
    };
    if (!validStatuses.has(application.status)) throw new Error("Invalid initial status");

    await db.send(new PutCommand({
      TableName: process.env.APPLICATIONS_TABLE,
      Item: application,
      ConditionExpression: "attribute_not_exists(applicationId)"
    }));
    await db.send(new PutCommand({
      TableName: process.env.HISTORY_TABLE,
      Item: { applicationId, timestamp: now, action: "Application submitted", status: "Submitted", actor: "student" }
    }));
    return response(201, { success: true, applicationId, courseName: course.Item.courseName, status: "Submitted" });
  } catch (error) {
    console.error("createApplication failed", { name: error.name, message: error.message });
    if (error.name === "ConditionalCheckFailedException") return response(409, { success: false, message: "Please submit the application again." });
    return response(500, { success: false, message: "Unable to submit the application." });
  }
};
