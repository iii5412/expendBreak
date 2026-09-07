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
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "FileExport")
public class FileExportPlugin extends Plugin {
    @PluginMethod
    public void saveJson(PluginCall call) {
        String fileName = call.getString("fileName");
        String content = call.getString("content");

        if (fileName == null || fileName.trim().isEmpty() || content == null) {
            call.reject("File name and content are required");
            return;
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("application/json");
        intent.putExtra(Intent.EXTRA_TITLE, fileName);

        try {
            startActivityForResult(call, intent, "saveJsonResult");
        } catch (ActivityNotFoundException error) {
            call.reject("No app is available to save this file", error);
        }
    }

    @ActivityCallback
    public void saveJsonResult(PluginCall call, ActivityResult result) {
        JSObject response = new JSObject();
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            response.put("saved", false);
            call.resolve(response);
            return;
        }

        Uri target = result.getData().getData();
        String content = call.getString("content");
        if (target == null || content == null) {
            call.reject("The selected file could not be opened");
            return;
        }

        try (OutputStream output = getContext().getContentResolver().openOutputStream(target, "w")) {
            if (output == null) {
                call.reject("The selected file could not be opened");
                return;
            }
            output.write(content.getBytes(StandardCharsets.UTF_8));
            output.flush();
            response.put("saved", true);
            call.resolve(response);
        } catch (IOException error) {
            call.reject("Unable to save the JSON file", error);
        }
    }
}
