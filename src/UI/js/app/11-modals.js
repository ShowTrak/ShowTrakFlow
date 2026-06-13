async function CloseAllModals() {
  $('.modal').modal('hide');
  await Wait(300);
  return;
}

function FormatDependencyVersion(Version) {
  const RawVersion = Version ? String(Version) : '';
  const SemverMatch = RawVersion.match(/(\d+)\.(\d+)/);
  if (SemverMatch) return `${SemverMatch[1]}.${SemverMatch[2]}`;
  return RawVersion.replace(/^[~^<>=\s]+/, '') || '-';
}

function RenderAboutDependencyList(Dependencies = []) {
  const Group = $('<div class="SHOWTRAK_ABOUT_DEPENDENCY_GROUP"></div>');

  if (!Dependencies.length) {
    Group.append($('<div class="text-muted"></div>').text('None'));
    return Group;
  }

  for (const Dependency of Dependencies) {
    const Name = Dependency && Dependency.name ? String(Dependency.name) : 'unknown';
    const Version = FormatDependencyVersion(Dependency && Dependency.version);
    const Item = $('<div class="SHOWTRAK_ABOUT_DEPENDENCY_ITEM"></div>');
    const PackageLink = $(
      '<button type="button" class="btn btn-link p-0 SHOWTRAK_ABOUT_DEPENDENCY_LINK"></button>'
    )
      .text(Name)
      .attr('data-package-name', Name);

    Item.append($('<span class="SHOWTRAK_ABOUT_DEPENDENCY_NAME"></span>').append(PackageLink));
    Item.append($('<span class="SHOWTRAK_ABOUT_DEPENDENCY_VERSION"></span>').text(Version));
    Group.append(Item);
  }

  return Group;
}

async function OpenAboutModal() {
  await CloseAllModals();
  try {
    const Version = Config && Config.Application ? Config.Application.Version : null;
    $('#SHOWTRAK_ABOUT_VERSION').text(Version ? `Version ${Version}` : '');
  } catch {
    $('#SHOWTRAK_ABOUT_VERSION').text('');
  }

  const DependenciesContainer = $('#SHOWTRAK_ABOUT_DEPENDENCIES');
  const DependenciesCount = $('#SHOWTRAK_ABOUT_DEPENDENCY_COUNT');
  DependenciesContainer.empty().text('Loading dependencies...');
  DependenciesCount.text('');

  try {
    const [Err, Payload] = await window.API.GetProjectDependencies();
    if (Err) throw new Error(Err);

    const RuntimeDependencies = Array.isArray(Payload && Payload.dependencies)
      ? Payload.dependencies
      : [];

    DependenciesContainer.empty();
    DependenciesContainer.append(RenderAboutDependencyList(RuntimeDependencies));
    DependenciesCount.text(`${RuntimeDependencies.length} total`);
  } catch {
    DependenciesContainer.empty().text('Could not load dependencies.');
    DependenciesCount.text('Unavailable');
  }

  $('#SHOWTRAK_MODAL_ABOUT').modal('show');
}

async function OpenShow() {
  console.log('Opening ShowTrak file');
  const [Err] = await window.API.OpenShow();
  if (Err) {
    if (/cancelled by user/i.test(String(Err))) return;
    await Notify(String(Err), 'error');
    return;
  }
  await Notify('Opened ShowTrak file.', 'success');
}

// Derive a display name from a .ShowTrak path: basename without the extension.
function GetShowFileDisplayName(Path) {
  if (!Path) return '';
  const Base = String(Path).split(/[\\/]/).pop() || '';
  return Base.replace(/\.showtrak$/i, '');
}

// Show the currently open file name in the navbar (empty when none is open).
function RenderShowFileName(Path) {
  $('#APPLICATION_NAVBAR_FILE').text(GetShowFileDisplayName(Path));
}

async function SaveShow() {
  console.log('Saving ShowTrak file');
  const [Err] = await window.API.SaveShow();
  if (Err) {
    if (/cancelled by user/i.test(String(Err))) return;
    await Notify(String(Err), 'error');
    return;
  }
  await Notify('Saved ShowTrak file.', 'success');
}

async function SaveShowAs() {
  console.log('Saving ShowTrak file');
  const [Err] = await window.API.SaveShowAs();
  if (Err) {
    if (/cancelled by user/i.test(String(Err))) return;
    await Notify(String(Err), 'error');
    return;
  }
  await Notify('Saved ShowTrak file.', 'success');
}

async function NewShow() {
  const Confirmed = await ConfirmationDialog(
    'Create a new show? This clears the current working data.'
  );
  if (!Confirmed) return;
  const [Err] = await window.API.NewShow();
  if (Err) {
    await Notify(String(Err), 'error');
    return;
  }
  await Notify('Created new show.', 'success');
}
