import firebase_admin
from firebase_admin import credentials, auth, firestore
from fastapi import Header, HTTPException, Depends
import os

# Initialize Firebase Admin once
_cred_path = os.path.join(os.path.dirname(__file__), 'auto-db--updater-firebase-adminsdk-fbsvc-7365bca4e5.json')
cred = credentials.Certificate(_cred_path)
firebase_admin.initialize_app(cred)
fs_client = firestore.client()

ROLE_HIERARCHY = {
    'operator': 1,
    'reviewer': 2,
    'sde':      3,
    'admin':    4
}

async def get_current_user(authorization: str = Header(None)):
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(status_code=401, detail='Missing or invalid authorization header')
    
    token = authorization.replace('Bearer ', '')
    
    try:
        decoded = auth.verify_id_token(token)
    except Exception as e:
        raise HTTPException(status_code=401, detail=f'Invalid token: {str(e)}')
    
    # Fetch role and name from Firestore
    display_name = decoded.get('name')
    try:
        user_doc = fs_client.collection('users').document(decoded['uid']).get()
        if user_doc.exists:
            data = user_doc.to_dict()
            role = data.get('role', 'operator')
            display_name = data.get('displayName', display_name)
        else:
            role = 'operator'
    except Exception:
        role = 'operator'
    
    return {
        'uid':          decoded['uid'],
        'email':        decoded.get('email'),
        'display_name': display_name or decoded.get('email'),
        'role':         role
    }

def require_role(minimum_role: str):
    async def checker(user=Depends(get_current_user)):
        user_level    = ROLE_HIERARCHY.get(user['role'], 0)
        required_level = ROLE_HIERARCHY.get(minimum_role, 99)
        if user_level < required_level:
            raise HTTPException(
                status_code=403,
                detail=f"Requires {minimum_role} role. Your role: {user['role']}"
            )
        return user
    return checker

# Convenience dependencies
require_operator = Depends(require_role('operator'))
require_reviewer = Depends(require_role('reviewer'))
require_sde      = Depends(require_role('sde'))
require_admin    = Depends(require_role('admin'))
