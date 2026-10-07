import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*", "Access-Control-Allow-Headers": "Content-Type,Authorization", "Access-Control-Allow-Methods": "GET,OPTIONS" };
const isAdmin = (event) => String(event.requestContext?.authorizer?.jwt?.claims?.["cognito:groups"] || "").split(",").includes("admins");

export const handler = async (event) => {
  if (event.requestContext?.http?.method === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (!isAdmin(event)) return { statusCode: 403, headers, body: JSON.stringify({ success: false, message: "Admin access is required." }) };
  try {
    const q = event.queryStringParameters || {};
    const expressions = [];
    const names = {};
    const values = {};
    if (q.status) { expressions.push("#status = :status"); names["#status"] = "status"; values[":status"] = q.status; }
    if (q.courseId) { expressions.push("courseId = :courseId"); values[":courseId"] = q.courseId; }
    const result = await db.send(new ScanCommand({
      TableName: process.env.APPLICATIONS_TABLE,
      ...(expressions.length ? { FilterExpression: expressions.join(" AND "), ExpressionAttributeNames: names, ExpressionAttributeValues: values } : {})
    }));
    const term = String(q.search || "").trim().toLowerCase();
    const applications = (result.Items || []).filter((item) => !term || [item.applicationId, item.fullName, item.email, item.mobile, item.courseName].some((value) => String(value || "").toLowerCase().includes(term))).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, applications, count: applications.length }) };
  } catch (error) {
    console.error("adminList failed", { message: error.message });
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: "Unable to load applications." }) };
  }
};
