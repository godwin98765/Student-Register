import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const headers = { "Content-Type": "application/json", "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*", "Access-Control-Allow-Headers": "Content-Type,Authorization", "Access-Control-Allow-Methods": "GET,OPTIONS" };
const isAdmin = (event) => String(event.requestContext?.authorizer?.jwt?.claims?.["cognito:groups"] || "").split(",").includes("admins");

export const handler = async (event) => {
  if (event.requestContext?.http?.method === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (!isAdmin(event)) return { statusCode: 403, headers, body: JSON.stringify({ success: false, message: "Admin access is required." }) };
  const applicationId = event.pathParameters?.applicationId;
  if (!applicationId) return { statusCode: 400, headers, body: JSON.stringify({ success: false, message: "Application ID is required." }) };
  try {
    const [application, documents, history] = await Promise.all([
      db.send(new GetCommand({ TableName: process.env.APPLICATIONS_TABLE, Key: { applicationId } })),
      db.send(new QueryCommand({ TableName: process.env.DOCUMENTS_TABLE, KeyConditionExpression: "applicationId = :id", ExpressionAttributeValues: { ":id": applicationId } })),
      db.send(new QueryCommand({ TableName: process.env.HISTORY_TABLE, KeyConditionExpression: "applicationId = :id", ExpressionAttributeValues: { ":id": applicationId }, ScanIndexForward: false }))
    ]);
    if (!application.Item) return { statusCode: 404, headers, body: JSON.stringify({ success: false, message: "Application not found." }) };
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, application: application.Item, documents: documents.Items || [], history: history.Items || [] }) };
  } catch (error) {
    console.error("adminGet failed", { message: error.message });
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: "Unable to load application." }) };
  }
};
