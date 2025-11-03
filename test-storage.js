// Test script to run in browser console when the app is running
// This will help debug the local storage feature

const { invoke } = window.__TAURI__.core;

async function testLocalStorage() {
  console.log('=== Testing Local Storage ===');
  
  try {
    // Step 1: Get storage info
    console.log('Step 1: Getting storage info...');
    const storageInfo = await invoke('cmd_get_storage_info');
    console.log('Storage Info:', storageInfo);
    
    // Step 2: Start a review
    console.log('\nStep 2: Starting a review...');
    const metadata = await invoke('cmd_local_start_review', {
      owner: 'test-owner',
      repo: 'test-repo',
      prNumber: 999,
      commitId: 'abc123def456',
      body: 'Test review body'
    });
    console.log('Review started:', metadata);
    
    // Step 3: Add a comment
    console.log('\nStep 3: Adding a comment...');
    const comment = await invoke('cmd_local_add_comment', {
      owner: 'test-owner',
      repo: 'test-repo',
      prNumber: 999,
      filePath: 'src/test.ts',
      lineNumber: 42,
      side: 'RIGHT',
      body: 'This is a test comment',
      commitId: 'abc123def456'
    });
    console.log('Comment added:', comment);
    
    // Step 4: Get all comments
    console.log('\nStep 4: Getting all comments...');
    const comments = await invoke('cmd_local_get_comments', {
      owner: 'test-owner',
      repo: 'test-repo',
      prNumber: 999
    });
    console.log('All comments:', comments);
    
    // Step 5: Get metadata
    console.log('\nStep 5: Getting review metadata...');
    const meta = await invoke('cmd_local_get_review_metadata', {
      owner: 'test-owner',
      repo: 'test-repo',
      prNumber: 999
    });
    console.log('Metadata:', meta);
    
    console.log('\n✅ All tests passed! Check the storage info above for log file location.');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Error details:', {
      message: error.message || error,
      stack: error.stack
    });
  }
}

// Run the test
testLocalStorage();
