import { defineSecret } from "firebase-functions/params";

export const MEMBER_PASSWORD = defineSecret("MEMBER_PASSWORD");
export const ADMIN_PASSWORD = defineSecret("ADMIN_PASSWORD");
/** Random key used to scramble ballot IDs so nobody can tell whose ballot is whose. */
export const BALLOT_KEY = defineSecret("BALLOT_KEY");
