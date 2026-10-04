mod backup;
mod commands;
mod db;
mod ocr;
mod secrets;
mod sync;
mod util;

use std::sync::Mutex;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let db_path = dir.join("dyeai.db");
            // SQLCipher: keyed from the OS keyring; plaintext legacy DBs are
            // migrated to encrypted in place on first open.
            let conn = db::open_encrypted(&dir, &db_path)
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
            db::init(&conn)?;
            app.manage(commands::DbState(Mutex::new(conn)));
            sync::start(app.handle().clone(), dir.clone(), db_path.clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::login,
            commands::get_user,
            commands::update_profile,
            commands::update_avatar,
            commands::change_password,
            commands::list_masters,
            commands::create_master,
            commands::update_master,
            commands::lookup_gst,
            commands::get_tenant_settings,
            commands::save_tenant_settings,
            commands::get_job_work_settings,
            commands::save_job_work_settings,
            commands::get_invoice_numbering_settings,
            commands::save_invoice_numbering_settings,
            commands::list_challans,
            commands::get_challan,
            commands::create_challan,
            commands::update_challan,
            commands::get_challan_filter_options,
            commands::list_invoices,
            commands::get_invoice,
            commands::generate_invoices,
            commands::update_invoice_status,
            commands::update_invoice_details,
            commands::get_dashboard_stats,
            commands::get_activity_feed,
            commands::global_search,
            commands::process_scan_capture,
            commands::get_scan_extraction,
            commands::set_gemini_api_key,
            commands::get_gemini_config,
            commands::get_scan_photo,
            commands::set_gst_api_key,
            commands::get_gst_config,
            sync::get_sync_status,
            backup::backup_now,
            backup::restore_backup,
            backup::list_backups,
            backup::security_status_cmd,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}