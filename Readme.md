# Moxo Workspace Launcher

Launch Moxo workspaces in two steps:

1. Invite or establish RM-to-client relationships from an invite CSV.
2. Create group workspaces from a grouped member CSV.

## Step 1: RM client invite CSV

Use this first for fresh clients. The app calls `POST /v1/me/relationship/invite` using the advisor in `advisor_email`.

```csv
advisor_email,client_email,first_name,last_name,unique_id,phone_number,greet_message,include
pavan.prasad@moxo.com,sample.client001@yopmail.com,Sample,Client 001,,,Welcome to join,yes
pavan.prasad@moxo.com,sample.client002@yopmail.com,Sample,Client 002,,,Welcome to join,yes
```

Required columns:

- `advisor_email`
- `first_name`
- one of `client_email`, `unique_id`, or `phone_number`

Recommended columns:

- `last_name`
- `greet_message`
- `include`

Rows with `include` set to `no`, `false`, `0`, or `skip` are ignored.

## Step 2: Group workspace CSV

The app reads one CSV where every row is one member. Rows with the same `workspace_name` are grouped into one Moxo workspace.

Use this after the clients are valid in the Moxo org/context.

```csv
workspace_name,member_email,member_name,member_type,include
Sample Group 01,sample.client001@yopmail.com,Sample Client 001,MEMBER,yes
Sample Group 01,sample.client002@yopmail.com,Sample Client 002,MEMBER,yes
Sample Group 01,pavan.prasad@moxo.com,Internal Owner 1,BOARD_OWNER,yes
Sample Group 01,raman.singh@moxo.com,Internal Owner 2,MEMBER,yes
```

Required columns:

- `workspace_name`
- `member_email`

Recommended columns:

- `member_name`
- `member_type`
- `member_source`
- `building`
- `batch`
- `unit_keys`
- `include`
- `notes`

Use `member_type=BOARD_OWNER` for exactly one member in each workspace.

Rows with `include` set to `no`, `false`, `0`, or `skip` are ignored.

## How it works

1. Configure API credentials.
2. Generate a token.
3. Upload or paste the RM client invite CSV.
4. Click **Invite RM Clients**.
5. Upload or paste the grouped member CSV.
6. Click **Create Group Workspaces**.
7. The app creates one binder per `workspace_name`, with all matching members.

## Important

For group workspace creation, all member emails must already exist or qualify in the Moxo organization context. For fresh clients, run the RM client invite step first.
