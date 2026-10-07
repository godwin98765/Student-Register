import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const headers = { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=ssmiet-applications.csv", "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*", "Access-Control-Allow-Headers": "Content-Type,Authorization", "Access-Control-Allow-Methods": "GET,OPTIONS" };
const isAdmin = (event) => String(event.requestContext?.authorizer?.jwt?.claims?.["cognito:groups"] || "").split(",").includes("admins");
const cell = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;

export const handler = async (event) => {
  if (event.requestContext?.http?.method === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (!isAdmin(event)) return { statusCode: 403, headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ success: false, message: "Admin access is required." }) };
  try {
    const q = event.queryStringParameters || {};
    const expressions = [];
    const names = {};
    const values = {};
    if (q.status) { expressions.push("#status = :status"); names["#status"] = "status"; values[":status"] = q.status; }
    if (q.courseId) { expressions.push("courseId = :courseId"); values[":courseId"] = q.courseId; }
    const result = await db.send(new ScanCommand({ TableName: process.env.APPLICATIONS_TABLE, ...(expressions.length ? { FilterExpression: expressions.join(" AND "), ExpressionAttributeNames: names, ExpressionAttributeValues: values } : {}) }));
    const fields = ["Application ID", "Student Name", "Email", "Mobile", "Department", "Course", "Status", "Registration Date"];
    const rows = (result.Items || []).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map((item) => [item.applicationId, item.fullName, item.email, item.mobile, item.department, item.courseName, item.status, item.createdAt].map(cell).join(","));
    return { statusCode: 200, headers, body: [fields.map(cell).join(","), ...rows].join("\n") };
  } catch (error) {
    console.error("adminExport failed", { message: error.message });
    return { statusCode: 500, headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ success: false, message: "Unable to export applications." }) };
  }
};
