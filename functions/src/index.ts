import { initializeApp } from "firebase-admin/app";
import { setGlobalOptions } from "firebase-functions";

initializeApp();
setGlobalOptions({ region: "us-central1", maxInstances: 10 });

export { enterPassword, identifyMember, switchMember, adminClearPin, adminRemoveMember } from "./auth";
export { updateMeeting, archiveMeeting, deletePastMeeting } from "./meeting";
export { seedDemo } from "./seed";
export { openPoll, setAvailability, closePoll, reopenPoll } from "./polls";
