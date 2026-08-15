const SAMPLE_DIFF = `diff --git a/src/UserList.tsx b/src/UserList.tsx
--- a/src/UserList.tsx
+++ b/src/UserList.tsx
@@ -1,3 +1,12 @@
+const API_KEY = "sk-live-abcdef123456";
+export function UserList({ users }: { users: any }) {
+  console.log("rendering", users);
+  return (
+    <ul>
+      {users.map((u) => <li>{u.name}</li>)}
+    </ul>
+  );
+}
`;
