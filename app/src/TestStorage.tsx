import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export function TestStorage() {
  const [output, setOutput] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);

  const runTest = async () => {
    setIsLoading(true);
    setOutput("=== Testing Local Storage ===\n\n");

    try {
      // Step 1: Get storage info
      setOutput((prev) => prev + "1. Getting storage info...\n");
      const info = await invoke<string>("cmd_get_storage_info");
      setOutput((prev) => prev + info + "\n\n");

      // Step 2: Start a review
      setOutput((prev) => prev + "2. Starting review...\n");
      const metadata = await invoke("cmd_local_start_review", {
        owner: "test",
        repo: "test-repo",
        prNumber: 123,
        commitId: "abc123",
        body: "Test review",
      });
      setOutput((prev) => prev + "✅ Review started: " + JSON.stringify(metadata, null, 2) + "\n\n");

      // Step 3: Add a comment
      setOutput((prev) => prev + "3. Adding comment...\n");
      const comment = await invoke("cmd_local_add_comment", {
        owner: "test",
        repo: "test-repo",
        prNumber: 123,
        filePath: "src/test.ts",
        lineNumber: 42,
        side: "RIGHT",
        body: "Test comment",
        commitId: "abc123",
      });
      setOutput((prev) => prev + "✅ Comment added: " + JSON.stringify(comment, null, 2) + "\n\n");

      // Step 4: Get comments
      setOutput((prev) => prev + "4. Getting comments...\n");
      const comments = await invoke("cmd_local_get_comments", {
        owner: "test",
        repo: "test-repo",
        prNumber: 123,
      });
      setOutput((prev) => prev + "✅ Comments: " + JSON.stringify(comments, null, 2) + "\n\n");

      setOutput((prev) => prev + "✅ ALL TESTS PASSED!\n");
      setOutput((prev) => prev + "\n📁 Check the log file at the path shown in step 1\n");
    } catch (error) {
      setOutput((prev) => prev + "\n❌ TEST FAILED: " + String(error) + "\n");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div style={{ padding: "20px", fontFamily: "monospace" }}>
      <h2>Storage Test</h2>
      <button
        onClick={runTest}
        disabled={isLoading}
        style={{
          padding: "10px 20px",
          fontSize: "16px",
          marginBottom: "20px",
          cursor: isLoading ? "wait" : "pointer",
        }}
      >
        {isLoading ? "Running..." : "Run Storage Test"}
      </button>
      <pre
        style={{
          background: "#1e1e1e",
          color: "#d4d4d4",
          padding: "15px",
          borderRadius: "5px",
          overflow: "auto",
          maxHeight: "600px",
          whiteSpace: "pre-wrap",
        }}
      >
        {output || "Click the button to run the test"}
      </pre>
    </div>
  );
}
