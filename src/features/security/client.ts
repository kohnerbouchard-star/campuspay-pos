import { apiFetch } from '@/lib/api/client'
export function requestStepUp(input:{superAdminEmployeeCode:string;superAdminPin:string;purpose:'RESET_STUDENT_PIN'|'RESET_STUDENT_CARD';studentId:string}){return apiFetch<{authorizationToken:string;expiresAt:string}>('/api/security/step-up',{method:'POST',body:JSON.stringify(input)})}
export function postPinReset(studentId:string,input:{authorizationToken:string;newPin:string;confirmationPin:string}){return apiFetch(`/api/security/students/${studentId}/pin-reset`,{method:'POST',body:JSON.stringify(input)})}
export function postCardReset(studentId:string,input:{authorizationToken:string;newCardRead:string}){return apiFetch(`/api/security/students/${studentId}/card-reset`,{method:'POST',body:JSON.stringify(input)})}
