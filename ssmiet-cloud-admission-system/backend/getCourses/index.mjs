import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const headers = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN || "*",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Allow-Methods": "GET,OPTIONS"
};

export const handler = async (event) => {
  if (event.requestContext?.http?.method === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  try {
    const result = await db.send(new ScanCommand({
      TableName: process.env.COURSES_TABLE,
      FilterExpression: "#active = :active",
      ExpressionAttributeNames: { "#active": "active" },
      ExpressionAttributeValues: { ":active": true }
    }));

    const courses = (result.Items || []).sort((a, b) =>
      `${a.category}|${a.courseName}`.localeCompare(`${b.category}|${b.courseName}`)
    );
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, courses }) };
  } catch (error) {
    console.error("getCourses failed", { message: error.message });
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, message: "Unable to load programmes." }) };
  }
};
