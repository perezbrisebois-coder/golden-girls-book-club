import { defineSecret } from "firebase-functions/params";

export const MEMBER_PASSWORD = defineSecret("MEMBER_PASSWORD");
export const ADMIN_PASSWORD = defineSecret("ADMIN_PASSWORD");
