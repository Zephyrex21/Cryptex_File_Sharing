# CloudVault

A secure token-based file sharing platform built with the MERN stack and Supabase Storage.

CloudVault allows users to upload files, organize them into folders, generate unique share tokens, and control access through public/private visibility settings. File contents are stored in Supabase Storage while metadata is managed through MongoDB.

---

Live Preview : https://cryptex-file-sharing.onrender.com/

---


# Features

### File Management
- Upload files securely
- Download files
- Preview supported files
- Rename files
- Delete files

### Folder Management
- Create folders
- Organize files into folders
- Rename folders
- Delete folders

### Token-Based Sharing
- Unique share token generated for every file and folder
- Access shared content without exposing database IDs
- Easy and secure sharing mechanism

### Visibility Controls
- Public files/folders
- Private files/folders
- Toggle visibility anytime

### Storage Architecture
- MongoDB stores metadata
- Supabase Storage stores actual files
- Express API handles uploads and access control

---

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/Zephyrex21/Cryptex_File_Sharing.git
cd cryptex
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

Create a `.env` file and add the required values.

### 4. Start Development Server

```bash
npm run dev
```

### 5. Start Production Server

```bash
npm start
```
---

## Environment Variables

Create a `.env` file in the root directory.

Example:

```env
# MongoDB Atlas URI
MONGO_URI=

# Supabase Project URL
SUPABASE_URL=

# Supabase Service Role Key
SUPABASE_SERVICE_KEY=

# Supabase Storage Bucket Name
SUPABASE_BUCKET=

# Backend Port
PORT=3000
```
---


## API Routes

### File Routes

| Method | Endpoint | Description |
|----------|----------|-------------|
| POST | `/api/files/upload` | Upload file |
| GET | `/api/files` | Get all files |
| GET | `/api/files/:id` | Get file details |
| GET | `/api/files/:id/download` | Download file |
| GET | `/api/files/:id/preview` | Preview file |
| PATCH | `/api/files/:id` | Rename file |
| PATCH | `/api/files/:id/visibility` | Change visibility |
| DELETE | `/api/files/:id` | Delete file |
| GET | `/api/files/token/:token` | Access via token |

---

### Folder Routes

| Method | Endpoint | Description |
|----------|----------|-------------|
| POST | `/api/folders` | Create folder |
| GET | `/api/folders` | Get folders |
| GET | `/api/folders/:id` | Folder details |
| PATCH | `/api/folders/:id` | Rename folder |
| PATCH | `/api/folders/:id/visibility` | Change visibility |
| DELETE | `/api/folders/:id` | Delete folder |
| POST | `/api/folders/:id/files` | Add file to folder |
| DELETE | `/api/folders/:id/files/:fileId` | Remove file from folder |
| GET | `/api/folders/token/:token` | Access via token |

---

## How It Works

1. User uploads a file.
2. File is stored in Supabase Storage.
3. Metadata is stored in MongoDB.
4. A unique token is generated.
5. Users can share the token to provide access.
6. Visibility settings determine whether content appears publicly.

---

## Security Considerations

- Sensitive credentials are stored in environment variables.
- Database IDs are never exposed for sharing.
- Supabase Service Role Key remains server-side.
- Private files can only be accessed through their token.

---

## Future Improvements

- User authentication
- User-specific storage spaces
- Expiring share links
- Password-protected shares
- File versioning
- Storage analytics dashboard

---

## Author

Built by Saurabh Raj Shekhar using MERN Stack and Supabase Storage.

---

## License

This project is licensed under the ISC License.
