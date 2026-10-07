import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*", "Access-Control-Allow-Headers": "Content-Type,Authorization", "Access-Control-Allow-Methods": "PATCH,OPTIONS" };
const allowedStatuses = new Set(["Submitted", "Under Review", "Documents Verified", "Callback Required", "Student Contacted", "Confirmed", "Correction Requested", "Rejected"]);
const isAdmin = (event) => String(event.requestContext?.authorizer?.jwt?.claims?.["cognito:groups"] || "").split(",").includes("admins");

export const handler = async (event) => {
  if (event.requestContext?.http?.method === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (!isAdmin(event)) return { statusCode: 403, headers, body: JSON.stringify({ success: false, message: "Admin access is required." }) };
  try {
    const applicationId = event.pathParameters?.applicationId;
    const input = JSON.parse(event.body || "{}");
    if (!applicationId || !allowedStatuses.has(input.status)) return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: "Select a valid application status." }) };
    const current = await db.send(new GetCommand({ TableName: process.env.APPLICATIONS_TABLE, Key: { applicationId } }));
    if (!current.Item) return { statusCode: 404, headers, body: JSON.stringify({ success: false, message: "Application not found." }) };

    const now = new Date().toISOString();
    const actor = event.requestContext?.authorizer?.jwt?.claims?.email || "admin";
    await db.send(new UpdateCommand({
      TableName: process.env.APPLICATIONS_TABLE,
      Key: { applicationId },
      UpdateExpression: "SET #status = :status, updatedAt = :updatedAt, studentVisibleMessage = :message",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":status": input.status, ":updatedAt": now, ":message": String(input.studentVisibleMessage || "") }
    }));
    await db.send(new PutCommand({
      TableName: process.env.HISTORY_TABLE,
      Item: { applicationId, timestamp: now, action: "Status updated", status: input.status, actor, internalNote: String(input.internalNote || ""), studentVisibleMessage: String(input.studentVisibleMessage || ""), contact: input.contact || null }
    }));
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, applicationId, status: input.status, updatedAt: now }) };
  } catch (error) {
    console.error("adminUpdateStatus failed", { message: error.message });
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: "Unable to update the application." }) };
  }
};
