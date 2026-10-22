import os
import asyncio
from supabase import create_client, Client
from dotenv import load_dotenv
import random
import string

load_dotenv()

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def generate_password(length=12):
    chars = string.ascii_letters + string.digits + "!@#$%^&*"
    return ''.join(random.choice(chars) for _ in range(length))

def main():
    email = "aadish241@gmail.com"
    password = generate_password()
    print(f"Creating user with email: {email}")
    
    try:
        # Check if user already exists
        # In python supabase client, admin.create_user is the way.
        user_response = supabase.auth.admin.create_user({
            "email": email,
            "password": password,
            "email_confirm": True
        })
        user = user_response.user
        print(f"User created successfully! ID: {user.id}")
        print(f"Password: {password}")
        
        # Now create the profile in `users` table
        try:
            supabase.table("users").upsert({
                "id": user.id,
                "display_name": "Aadish",
                "phone": "+919999999999" 
            }).execute()
            print("User profile inserted/updated.")
        except Exception as e:
            print(f"User profile error: {e}")

        # Update all complaints to belong to this user
        try:
            update_response = supabase.table("complaints").update({
                "user_id": user.id
            }).is_("user_id", "null").execute() # Update all where user_id is null, or just all
            
            update_all_response = supabase.table("complaints").update({
                "user_id": user.id
            }).neq("id", "00000000-0000-0000-0000-000000000000").execute() # Hack to update all existing rows

            print(f"Complaints updated to belong to user: {user.id}")
        except Exception as e:
            print(f"Error updating complaints: {e}")

    except Exception as e:
        print(f"Error creating user: {e}")

if __name__ == "__main__":
    main()
