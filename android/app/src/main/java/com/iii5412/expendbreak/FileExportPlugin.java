package com.iii5412.expendbreak;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "FileExport")
public class FileExportPlugin extends Plugin {
    private static final String PENDING_FILE_PREFIX = "diagnostic-export-";
    private static final int COPY_BUFFER_SIZE = 16 * 1024;

    @PluginMethod
    public void saveJson(PluginCall call) {
        String fileName = call.getString("fileName");
        String content = call.getString("content");

        if (fileName == null || fileName.trim().isEmpty() || content == null || content.isEmpty()) {
            call.reject("File name and content are required");
            return;
        }

        File pendingFile;
        byte[] contentBytes = content.getBytes(StandardCharsets.UTF_8);
        try {
            pendingFile = File.createTempFile(PENDING_FILE_PREFIX, ".json", getContext().getCacheDir());
            try (FileOutputStream output = new FileOutputStream(pendingFile, false)) {
                output.write(contentBytes);
                output.flush();
                output.getFD().sync();
            }
        } catch (IOException error) {
            call.reject("Unable to prepare the JSON file", error);
            return;
        }

        // The system document picker can stop and recreate the Activity. Keeping a
        // large JSON string in PluginCall would then copy it into Android's saved
        // instance state and may exceed the Binder transaction limit. Persist only
        // the small cache-file reference while the picker is open.
        call.getData().remove("content");
        call.getData().put("pendingFile", pendingFile.getName());
        call.getData().put("expectedBytes", contentBytes.length);

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, fileName);

        try {
            startActivityForResult(call, intent, "saveJsonResult");
        } catch (ActivityNotFoundException error) {
            deletePendingFile(pendingFile);
            call.reject("No app is available to save this file", error);
        }
    }

    @ActivityCallback
    public void saveJsonResult(PluginCall call, ActivityResult result) {
        File pendingFile = resolvePendingFile(call);
        JSObject response = new JSObject();
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            deletePendingFile(pendingFile);
            response.put("saved", false);
            call.resolve(response);
            return;
        }

        Uri target = result.getData().getData();
        Integer expectedBytes = call.getInt("expectedBytes");
        if (target == null || pendingFile == null || expectedBytes == null || expectedBytes <= 0) {
            deletePendingFile(pendingFile);
            call.reject("The selected file could not be opened");
            return;
        }

        try {
            long writtenBytes;
            try (
                InputStream input = new FileInputStream(pendingFile);
                OutputStream output = getContext().getContentResolver().openOutputStream(target, "rwt")
            ) {
                if (output == null) {
                    throw new IOException("The selected file could not be opened");
                }
                writtenBytes = copy(input, output);
                output.flush();
            }

            long verifiedBytes = countBytes(target);
            if (writtenBytes != expectedBytes || verifiedBytes != expectedBytes) {
                throw new IOException(
                    "JSON file size mismatch: expected " + expectedBytes
                        + ", wrote " + writtenBytes
                        + ", verified " + verifiedBytes
                );
            }

            response.put("saved", true);
            response.put("bytesWritten", writtenBytes);
            call.resolve(response);
        } catch (IOException error) {
            call.reject("Unable to save the JSON file", error);
        } finally {
            deletePendingFile(pendingFile);
        }
    }

    private File resolvePendingFile(PluginCall call) {
        String pendingName = call.getString("pendingFile");
        if (pendingName == null || !pendingName.startsWith(PENDING_FILE_PREFIX)) return null;

        try {
            File cacheDir = getContext().getCacheDir().getCanonicalFile();
            File pendingFile = new File(cacheDir, pendingName).getCanonicalFile();
            if (!cacheDir.equals(pendingFile.getParentFile()) || !pendingFile.isFile()) return null;
            return pendingFile;
        } catch (IOException error) {
            return null;
        }
    }

    private long countBytes(Uri target) throws IOException {
        try (InputStream input = getContext().getContentResolver().openInputStream(target)) {
            if (input == null) throw new IOException("The saved file could not be verified");

            long total = 0;
            byte[] buffer = new byte[COPY_BUFFER_SIZE];
            int count;
            while ((count = input.read(buffer)) != -1) total += count;
            return total;
        }
    }

    private static long copy(InputStream input, OutputStream output) throws IOException {
        long total = 0;
        byte[] buffer = new byte[COPY_BUFFER_SIZE];
        int count;
        while ((count = input.read(buffer)) != -1) {
            output.write(buffer, 0, count);
            total += count;
        }
        return total;
    }

    private static void deletePendingFile(File pendingFile) {
        if (pendingFile != null && pendingFile.exists() && !pendingFile.delete()) {
            pendingFile.deleteOnExit();
        }
    }
}
