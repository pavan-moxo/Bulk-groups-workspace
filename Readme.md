# Moxo Group Workspace Creator

Create Moxo group workspaces from one grouped member CSV.

## What changed

The app now reads one CSV where every row is one member. Rows with the same `workspace_name` are grouped into one Moxo workspace.

This supports launch sheets like `Group_Members_Launch`.

## Required CSV format

```csv
workspace_name,building,batch,member_email,member_name,member_type,member_source,unit_keys,include,notes
Sample Tower A,Sample Tower,A,client001@example.com,Sample Client 001,MEMBER,owner,ST101,yes,
Sample Tower A,Sample Tower,A,pavan.prasad@moxo.com,Internal Owner 1,BOARD_OWNER,internal,,yes,
Sample Tower A,Sample Tower,A,raman.singh@moxo.com,Internal Owner 2,MEMBER,internal,,yes,
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
3. Upload or paste the grouped member CSV.
4. The app validates the rows.
5. Click **Create Group Workspaces**.
6. The app creates one binder per `workspace_name`, with all matching members.

## Important

All member emails must already exist in the Moxo organization before launch.
